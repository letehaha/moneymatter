import {
  type CreateCustomCurrencyBody,
  type CurrencyInUseBlocker,
  type CustomCurrencyModel,
  type UpdateCustomCurrencyBody,
} from '@bt/shared/types';
import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import { namespace } from '@models/connection';
import Currencies, { customCurrencyStub } from '@models/currencies.model';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import { findTransactions } from '@models/transactions-query';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';
import { serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import { applyLogoWrite } from '@services/brand-logos';
import { insertOrAdopt } from '@services/common/run-in-savepoint';
import { withTransaction } from '@services/common/with-transaction';
import { deleteLogoImage } from '@services/logo-images/logo-images.service';
import cc from 'currency-codes';
import { Op } from 'sequelize';

import { applyCurrencyOverrides } from './effective-currency';
import { assertCurrencyNotInUse, clearForeignAmountsInCurrency } from './get-currency-in-use-blockers';
import { lockUserCurrencies } from './lock-user-currencies';
import { pruneUnusedCustomCurrencies } from './prune-custom-currencies';

/** Reads the global currency row under FOR SHARE inside the ambient CLS transaction. */
const lockCurrencyRow = ({ code }: { code: string }) => {
  const sequelizeTx = namespace.get('transaction');

  return Currencies.findOne({ where: { code }, transaction: sequelizeTx, lock: sequelizeTx?.LOCK.SHARE });
};

const toCustomCurrencyModel = ({
  currency,
  held,
}: {
  currency: Currencies;
  held: UsersCurrencies;
}): CustomCurrencyModel => {
  const effective = applyCurrencyOverrides({ currency, overrides: held });

  return {
    code: effective.code,
    name: effective.name,
    decimals: effective.decimals,
    symbol: effective.symbol,
    isCustom: true,
    ...serializeLogoFields({ entity: held }),
  };
};

/**
 * Shared accounts of other owners that carry the user's own transactions in the code: those rows
 * were rounded with the code's decimals too, but the account blocker only sees the user's accounts.
 */
const findSharedAccountBlockers = async ({
  userId,
  code,
}: {
  userId: number;
  code: string;
}): Promise<CurrencyInUseBlocker[]> => {
  const rows = await findTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { currencyCode: code },
    attributes: ['accountId'],
    group: ['accountId'],
    paranoid: false,
    raw: true,
  });
  if (!rows.length) return [];

  const accounts = await Accounts.findAll({
    where: { id: { [Op.in]: rows.map((row) => row.accountId) }, userId: { [Op.ne]: userId } },
    attributes: ['id', 'name'],
  });

  return accounts.map((account) => ({ type: 'account', id: account.id, name: account.name }));
};

const findOwnCustomCurrency = async ({ userId, code }: { userId: number; code: string }) =>
  UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    include: [{ model: Currencies, as: 'currency', where: { isCustom: true }, required: true }],
  }) as Promise<(UsersCurrencies & { currency: Currencies }) | null>;

const requireOwnCustomCurrency = ({ userId, code }: { userId: number; code: string }) =>
  findOrThrowNotFound({
    query: findOwnCustomCurrency({ userId, code }),
    message: t({ key: 'currencies.customCurrencyNotFound', variables: { code } }),
  });

export const listCustomCurrencies = async ({ userId }: { userId: number }): Promise<CustomCurrencyModel[]> => {
  const held = (await UsersCurrencies.findAll({
    where: { userId },
    include: [{ model: Currencies, as: 'currency', where: { isCustom: true }, required: true }],
    order: [['currencyCode', 'ASC']],
  })) as (UsersCurrencies & { currency: Currencies })[];

  return held.map((row) => toCustomCurrencyModel({ currency: row.currency, held: row }));
};

/** The ISO currency a custom currency is quoted in: the given one if the user holds it, else their base. */
export const resolveRateQuoteCode = async ({ userId, quoteCode }: { userId: number; quoteCode?: string }) => {
  const held = quoteCode
    ? ((await UsersCurrencies.findOne({
        where: { userId, currencyCode: quoteCode },
        include: [{ model: Currencies, as: 'currency' }],
      })) as (UsersCurrencies & { currency: Currencies }) | null)
    : await getBaseCurrency({ userId });

  if (!held) {
    throw new ValidationError({
      message: quoteCode
        ? t({ key: 'userCurrencies.currencyNotExist', variables: { currencyCode: quoteCode } })
        : t({ key: 'currencies.customCurrencyRateNeedsQuote' }),
    });
  }
  if (held.currency.isCustom) {
    throw new ValidationError({
      message: t({ key: 'currencies.customCurrencyQuoteNotIso', variables: { code: held.currencyCode } }),
    });
  }

  return held.currencyCode;
};

/**
 * Defines a custom currency with its rate. The global row is a shared stub; the definition lives in
 * the user's own `UsersCurrencies` row, so two users can define the same code differently.
 */
export const createCustomCurrency = withTransaction(
  async ({
    userId,
    code,
    name,
    decimals,
    symbol,
    rate,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
  }: CreateCustomCurrencyBody & { userId: number }) => {
    await lockUserCurrencies({ userId });

    // FOR SHARE keeps `pruneUnusedCustomCurrencies` from deleting the row before the holding insert
    // below (the delete would cascade the new holding away).
    const existing = await lockCurrencyRow({ code });

    if ((existing && !existing.isCustom) || cc.code(code) !== undefined) {
      throw new ConflictError({ message: t({ key: 'currencies.customCurrencyIsoCode', variables: { code } }) });
    }

    if (await UsersCurrencies.findOne({ where: { userId, currencyCode: code } })) {
      throw new ConflictError({ message: t({ key: 'currencies.customCurrencyAlreadyDefined', variables: { code } }) });
    }

    const quoteCode = await resolveRateQuoteCode({ userId, quoteCode: rate.quoteCode });

    // Two users defining the same new code at once: the loser adopts the winner's row.
    const currency =
      existing ??
      (await insertOrAdopt({
        insert: () => Currencies.create(customCurrencyStub({ code })),
        adopt: () => lockCurrencyRow({ code }),
      }));

    const logoPatch = await applyLogoWrite({ write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage } });

    const held = await UsersCurrencies.create({
      userId,
      currencyCode: code,
      // A custom currency has no market rate; the user's own rate applies.
      liveRateUpdate: false,
      isDefaultCurrency: false,
      nameOverride: name,
      symbolOverride: symbol ?? null,
      decimalsOverride: decimals,
      ...logoPatch,
    });

    // Written directly: `updateRates` would also switch live rates off on the ISO quote. The first
    // rate also values every day before it.
    await UserExchangeRates.create({
      userId,
      baseCode: code,
      quoteCode,
      rate: rate.value,
      effectiveDate: toEffectiveDate({ date: new Date() }),
      source: 'initial',
    });

    return toCustomCurrencyModel({ currency, held });
  },
);

const updateCustomCurrencyImpl = async ({
  userId,
  code,
  name,
  decimals,
  symbol,
  logoDomain,
  logoInitials,
  logoColor,
  logoIcon,
  logoImage,
}: UpdateCustomCurrencyBody & { userId: number; code: string }) => {
  const held = await requireOwnCustomCurrency({ userId, code });
  const current = applyCurrencyOverrides({ currency: held.currency, overrides: held });
  const decimalsChanged = decimals !== undefined && decimals !== current.decimals;

  if (decimalsChanged) {
    await assertCurrencyNotInUse({
      userId,
      currencyCode: code,
      message: t({ key: 'currencies.customCurrencyDecimalsInUse', variables: { code } }),
      extraBlockers: await findSharedAccountBlockers({ userId, code }),
    });
    // Foreign amounts and detected candidates were rounded at the old decimals.
    await clearForeignAmountsInCurrency({ userId, currencyCode: code });
    await SubscriptionCandidates.destroy({ where: { userId, currencyCode: code } });
  }

  const logoPatch = await applyLogoWrite({
    write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage },
    stored: held,
  });

  await held.update({
    ...(name !== undefined && { nameOverride: name }),
    ...(symbol !== undefined && { symbolOverride: symbol }),
    ...(decimals !== undefined && { decimalsOverride: decimals }),
    ...logoPatch,
  });

  return toCustomCurrencyModel({ currency: held.currency, held });
};

const updateCustomCurrencyInTx = withTransaction(updateCustomCurrencyImpl);

export const updateCustomCurrency = async (
  params: UpdateCustomCurrencyBody & { userId: number; code: string },
): Promise<CustomCurrencyModel> => {
  const currency = await updateCustomCurrencyInTx(params);

  // After the commit, so a concurrent read cannot repopulate the cache from the old definition.
  // The converted-amount cache needs no drop: it never holds a conversion with a custom side.
  invalidateCurrencyDecimalsCache({ userId: params.userId, code: params.code });

  return currency;
};

const deleteCustomCurrencyInTx = withTransaction(async ({ userId, code }: { userId: number; code: string }) => {
  const held = await requireOwnCustomCurrency({ userId, code });

  await assertCurrencyNotInUse({
    userId,
    currencyCode: code,
    message: t({ key: 'userCurrencies.currencyInUse', variables: { currencyCode: code } }),
    extraBlockers: await findSharedAccountBlockers({ userId, code }),
  });
  await clearForeignAmountsInCurrency({ userId, currencyCode: code });

  // The user's own rates and detected candidates for the code go with it.
  await UserExchangeRates.destroy({
    where: { userId, [Op.or]: [{ baseCode: code }, { quoteCode: code }] },
  });
  await SubscriptionCandidates.destroy({ where: { userId, currencyCode: code } });
  if (held.logoImageId) await deleteLogoImage({ id: held.logoImageId });
  await UsersCurrencies.destroy({ where: { userId, currencyCode: code } });
  await pruneUnusedCustomCurrencies();
});

/** Removes the user's custom currency, only while none of their rows use it. */
export const deleteCustomCurrency = async ({ userId, code }: { userId: number; code: string }): Promise<void> => {
  await deleteCustomCurrencyInTx({ userId, code });

  invalidateCurrencyDecimalsCache({ userId, code });
};
