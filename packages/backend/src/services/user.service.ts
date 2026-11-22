import type { RecordId } from '@bt/shared/types';
import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import * as Currencies from '@models/currencies.model';
import * as Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import * as Users from '@models/users.model';

import { withTransaction } from './common/with-transaction';
import { addUserCurrencies } from './currencies/add-user-currency';
import { withEffectiveCurrency } from './currencies/effective-currency';
import { assertCurrencyNotInUse, clearForeignAmountsInCurrency } from './currencies/get-currency-in-use-blockers';
import { recomputeCustomRefAmounts } from './currencies/recompute-custom-ref-amounts.service';
import { revalueAccountsInCurrencies } from './user-exchange-rate/revalue-accounts-in-currencies';

export const getUser = async (id: number) => {
  const user = await Users.default.findOne({
    where: { id },
    raw: true,
  });

  return user;
};

export const createUser = withTransaction(
  async ({
    username,
    firstName,
    lastName,
    middleName,
    avatar,
    totalBalance,
    authUserId,
    trialEndsAt,
  }: {
    username: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    avatar?: string;
    totalBalance?: number;
    authUserId?: string;
    trialEndsAt?: Date | null;
  }) => {
    const user = await Users.createUser({
      username,
      firstName,
      lastName,
      middleName,
      avatar,
      totalBalance,
      authUserId,
      trialEndsAt,
    });

    return user;
  },
);

export const updateUser = withTransaction(
  async ({
    id,
    username,
    firstName,
    lastName,
    middleName,
    avatar,
    totalBalance,
    defaultCategoryId,
  }: {
    id: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    avatar?: string;
    totalBalance?: number;
    defaultCategoryId?: RecordId;
  }) => {
    const user = await Users.updateUserById({
      id,
      username,
      firstName,
      lastName,
      middleName,
      avatar,
      totalBalance,
      defaultCategoryId,
    });

    return user;
  },
);

export const getUserCurrencies = withTransaction(async ({ userId }: { userId: number }) => {
  const list = await UsersCurrencies.getCurrencies({ userId });

  // A custom currency shows the user's own name, symbol and decimals, not the global row's.
  return list.map((item) => withEffectiveCurrency({ item }));
});

export const getUserBaseCurrency = withTransaction(({ userId }: { userId: number }) => {
  return UsersCurrencies.getBaseCurrency({ userId });
});

export const setBaseUserCurrency = withTransaction(
  async ({ userId, currencyCode }: { userId: number; currencyCode: string }) => {
    const existingBaseCurrency = await getUserBaseCurrency({ userId });

    if (existingBaseCurrency) {
      throw new ValidationError({ message: t({ key: 'userCurrencies.baseCurrencyExists' }) });
    }

    const currency = await Currencies.getCurrency({ code: currencyCode });

    if (!currency) {
      throw new ValidationError({
        message: t({ key: 'userCurrencies.currencyCodeNotExist' }),
      });
    }

    // UsersCurrencies.exchangeRate is always relative to the user's base currency,
    // so the base currency's rate against itself is trivially 1.
    await addUserCurrencies([
      {
        userId,
        currencyCode,
        exchangeRate: 1,
      },
    ]);

    const result = await setDefaultUserCurrency({ userId, currencyCode });

    return result;
  },
);

export const editUserCurrency = withTransaction(
  async ({
    userId,
    currencyCode,
    exchangeRate,
    liveRateUpdate,
  }: {
    userId: number;
    currencyCode: string;
    exchangeRate?: number;
    liveRateUpdate?: boolean;
  }) => {
    const passedCurrency = await UsersCurrencies.getCurrency({
      userId,
      currencyCode,
    });

    if (!passedCurrency) {
      throw new ValidationError({
        message: t({ key: 'userCurrencies.currencyNotExist', variables: { currencyCode } }),
      });
    }

    // A custom currency never follows a market; its rate is edited through the rate pairs.
    if (passedCurrency.currency.isCustom) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyRateViaPairs', variables: { code: currencyCode } }),
      });
    }

    const result = await UsersCurrencies.updateCurrency({
      userId,
      currencyCode,
      exchangeRate,
      liveRateUpdate,
    });

    // `liveRateUpdate` picks between a flat manual rate and per-day market rates for
    // every stored balance row in this currency, so the whole history must be rebuilt.
    if (liveRateUpdate !== undefined && liveRateUpdate !== passedCurrency.liveRateUpdate) {
      // The flag also decides whether the custom currencies pegged to or quoted in this currency
      // are worth its manual rate or the market's, so what they were valued with is valued again.
      await recomputeCustomRefAmounts({ userId, changes: [{ currencyCode, from: null, to: null }] });

      await revalueAccountsInCurrencies({ userId, pairs: [{ baseCode: currencyCode, quoteCode: currencyCode }] });
    }

    return result;
  },
);

export const setDefaultUserCurrency = withTransaction(
  async ({ userId, currencyCode }: { userId: number; currencyCode: string }) => {
    const passedCurrency = await UsersCurrencies.getCurrency({
      userId,
      currencyCode,
    });

    if (!passedCurrency) {
      throw new ValidationError({
        message: t({ key: 'userCurrencies.currencyNotExist', variables: { currencyCode } }),
      });
    }

    // A custom currency has no market rates to convert through, so it cannot be the reporting currency.
    if (passedCurrency.currency.isCustom) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyCannotBeBase', variables: { code: currencyCode } }),
      });
    }

    // Make all curerncies not default
    await UsersCurrencies.updateCurrencies({
      userId,
      isDefaultCurrency: false,
    });

    const result = await UsersCurrencies.updateCurrency({
      userId,
      currencyCode,
      isDefaultCurrency: true,
    });

    const currency = await Currencies.getCurrency({ code: currencyCode });
    if (!currency) {
      throw new UnexpectedError({ message: t({ key: 'userCurrencies.currencyCodeNotExist' }) });
    }

    await Transactions.updateTransactions(
      {
        refCurrencyCode: currency.code,
      },
      { userId, accountType: ACCOUNT_TYPES.system },
    );

    return result;
  },
);

export const deleteUserCurrency = withTransaction(
  async ({ userId, currencyCode }: { userId: number; currencyCode: string }) => {
    const passedCurrency = await UsersCurrencies.getCurrency({
      userId,
      currencyCode,
    });

    if (!passedCurrency) {
      throw new ValidationError({
        message: t({ key: 'userCurrencies.currencyNotExist', variables: { currencyCode } }),
      });
    }

    if (passedCurrency.isDefaultCurrency) {
      throw new ValidationError({
        message: t({ key: 'userCurrencies.cannotDeleteDefaultCurrency' }),
      });
    }

    // A custom currency has its own endpoint, which also removes the user's rates for it and the
    // global row once nobody holds it.
    if (passedCurrency.currency.isCustom) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyUseCustomEndpoint', variables: { code: currencyCode } }),
      });
    }

    await assertCurrencyNotInUse({
      userId,
      currencyCode,
      message: t({ key: 'userCurrencies.currencyInUse', variables: { currencyCode } }),
    });
    await clearForeignAmountsInCurrency({ userId, currencyCode });

    await UsersCurrencies.deleteCurrency({
      userId,
      currencyCode,
    });
  },
);
