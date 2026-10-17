import type { CreateCustomCurrencyBody, CustomCurrencyModel, UpdateCustomCurrencyBody } from '@bt/shared/types';
import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { namespace } from '@models/connection';
import Currencies from '@models/currencies.model';
import { connection } from '@models/index';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { insertOrAdopt } from '@services/common/run-in-savepoint';
import { withTransaction } from '@services/common/with-transaction';
import cc from 'currency-codes';
import { Op, QueryTypes } from 'sequelize';

import { type EffectiveCurrency, applyCurrencyOverrides } from './effective-currency';
import { pruneUnusedCustomCurrencies } from './prune-custom-currencies';

/**
 * Where a user's rows can use a currency. A custom currency is "in use" when any of these hold a
 * row of the user that names it: the decimals those rows were rounded to must not change under
 * them, and the currency must not vanish from beneath them. Soft-deleted transactions count, since
 * a restore would bring their amounts back.
 */
const USAGE_SOURCES = [
  { label: 'accounts', table: 'Accounts', columns: ['currencyCode'] },
  {
    label: 'transactions',
    table: 'Transactions',
    columns: ['currencyCode', 'originalCurrencyCode', 'refCurrencyCode'],
  },
  { label: 'templates', table: 'TransactionTemplates', columns: ['originalCurrencyCode'] },
  { label: 'subscriptions', table: 'Subscriptions', columns: ['expectedCurrencyCode'] },
  { label: 'subscription candidates', table: 'SubscriptionCandidates', columns: ['currencyCode'] },
  { label: 'budget plans', table: 'BudgetPlans', columns: ['currencyCode'] },
] as const;

/** Reads the global currency row under FOR SHARE inside the ambient CLS transaction. */
const lockCurrencyRow = ({ code }: { code: string }) => {
  const sequelizeTx = namespace.get('transaction');

  return Currencies.findOne({ where: { code }, transaction: sequelizeTx, lock: sequelizeTx?.LOCK.SHARE });
};

const toCustomCurrencyModel = (effective: EffectiveCurrency): CustomCurrencyModel => ({
  code: effective.code,
  name: effective.name,
  decimals: effective.decimals,
  symbol: effective.symbol,
  isCustom: true,
});

/** Labels of the user's data that use the currency; empty when nothing does. */
const findCurrencyUsage = async ({ userId, code }: { userId: number; code: string }): Promise<string[]> => {
  const usedBy: string[] = [];

  for (const { label, table, columns } of USAGE_SOURCES) {
    const condition = columns.map((column) => `"${column}" = :code`).join(' OR ');
    const rows = await connection.sequelize.query(
      `SELECT 1 FROM "${table}" WHERE "userId" = :userId AND (${condition}) LIMIT 1`,
      { replacements: { userId, code }, type: QueryTypes.SELECT },
    );
    if (rows.length) usedBy.push(label);
  }

  return usedBy;
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

  return held.map((row) => toCustomCurrencyModel(applyCurrencyOverrides({ currency: row.currency, overrides: row })));
};

/**
 * Defines a custom currency for the user. The global row is created on first use and reused when
 * another user defined the code before; the definition (name, symbol, decimals) always lands in
 * the user's own overrides, so two users can define the same code differently.
 */
export const createCustomCurrency = withTransaction(
  async ({ userId, code, name, decimals, symbol }: CreateCustomCurrencyBody & { userId: number }) => {
    const existing = await Currencies.findOne({ where: { code } });

    if ((existing && !existing.isCustom) || cc.code(code) !== undefined) {
      throw new ConflictError({ message: t({ key: 'currencies.customCurrencyIsoCode', variables: { code } }) });
    }

    if (await UsersCurrencies.findOne({ where: { userId, currencyCode: code } })) {
      throw new ConflictError({ message: t({ key: 'currencies.customCurrencyAlreadyDefined', variables: { code } }) });
    }

    // FOR SHARE keeps `pruneUnusedCustomCurrencies` from deleting the row between here and the holding
    // insert below (the delete would cascade the new holding away). A null result means a prune
    // removed the row after the read above, so it is created afresh.
    const lockedExisting = existing ? await lockCurrencyRow({ code }) : null;

    // Two users defining the same new code at once: the loser adopts the winner's row.
    const currency =
      lockedExisting ??
      (await insertOrAdopt({
        insert: () =>
          Currencies.create({
            code,
            currency: name,
            digits: decimals,
            number: null,
            isCustom: true,
            symbol: symbol ?? null,
            createdByUserId: userId,
          }),
        adopt: () => lockCurrencyRow({ code }),
      }));

    const held = await UsersCurrencies.create({
      userId,
      currencyCode: code,
      // A custom currency has no market rate; the user's own rate applies.
      liveRateUpdate: false,
      isDefaultCurrency: false,
      nameOverride: name,
      symbolOverride: symbol ?? null,
      decimalsOverride: decimals,
    });

    return toCustomCurrencyModel(applyCurrencyOverrides({ currency, overrides: held }));
  },
);

const updateCustomCurrencyImpl = async ({
  userId,
  code,
  name,
  decimals,
  symbol,
}: UpdateCustomCurrencyBody & { userId: number; code: string }) => {
  const held = await requireOwnCustomCurrency({ userId, code });
  const current = applyCurrencyOverrides({ currency: held.currency, overrides: held });
  const decimalsChanged = decimals !== undefined && decimals !== current.decimals;

  if (decimalsChanged) {
    const usedBy = await findCurrencyUsage({ userId, code });

    if (usedBy.length) {
      throw new ConflictError({
        message: t({ key: 'currencies.customCurrencyDecimalsInUse', variables: { code, usedBy: usedBy.join(', ') } }),
        details: { usedBy },
      });
    }
  }

  await held.update({
    ...(name !== undefined && { nameOverride: name }),
    ...(symbol !== undefined && { symbolOverride: symbol }),
    ...(decimals !== undefined && { decimalsOverride: decimals }),
  });

  return toCustomCurrencyModel(applyCurrencyOverrides({ currency: held.currency, overrides: held }));
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

  const usedBy = await findCurrencyUsage({ userId, code });

  if (usedBy.length) {
    throw new ConflictError({
      message: t({ key: 'currencies.customCurrencyInUse', variables: { code, usedBy: usedBy.join(', ') } }),
      details: { usedBy },
    });
  }

  // The user's own rates for the code go with it; nothing converts through a currency they dropped.
  await UserExchangeRates.destroy({
    where: { userId, [Op.or]: [{ baseCode: code }, { quoteCode: code }] },
  });
  await held.destroy();
  await pruneUnusedCustomCurrencies();
});

/** Removes the user's custom currency, only while none of their rows use it. */
export const deleteCustomCurrency = async ({ userId, code }: { userId: number; code: string }): Promise<void> => {
  await deleteCustomCurrencyInTx({ userId, code });

  invalidateCurrencyDecimalsCache({ userId, code });
};
