import type { RecordId } from '@bt/shared/types';
import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import * as Currencies from '@models/currencies.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import * as Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import * as Users from '@models/users.model';

import { withTransaction } from './common/with-transaction';
import { addUserCurrencies } from './currencies/add-user-currency';
import { withEffectiveCurrency } from './currencies/effective-currency';
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

    // An ISO currency's rate source follows the flag; a custom currency has no market feed.
    let rateSource: 'provider' | 'manual' | undefined;
    if (liveRateUpdate !== undefined && !passedCurrency.currency.isCustom) {
      rateSource = liveRateUpdate ? 'provider' : 'manual';
    }

    const result = await UsersCurrencies.updateCurrency({
      userId,
      currencyCode,
      exchangeRate,
      liveRateUpdate,
      rateSource,
    });

    // `liveRateUpdate` picks between a flat manual rate and per-day market rates for
    // every stored balance row in this currency, so the whole history must be rebuilt.
    if (liveRateUpdate !== undefined && liveRateUpdate !== passedCurrency.liveRateUpdate) {
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

    // A custom currency has its own endpoint, which also checks every kind of row that can use it
    // and removes the global row once nobody holds it.
    if (passedCurrency.currency.isCustom) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyUseCustomEndpoint', variables: { code: currencyCode } }),
      });
    }

    const accounts = await Accounts.getAccountsByCurrency({
      userId,
      currencyCode,
    });

    if (accounts.length) {
      throw new ValidationError({
        message: t({
          key: 'userCurrencies.cannotDeleteCurrencyWithAccounts',
          variables: { accountNames: accounts.map((item) => item.name).join(', ') },
        }),
        details: {
          accounts,
        },
      });
    }

    // Holdings own their currency too: refAmount lookups on investment txs
    // require the link, so disconnect must not leave orphan investments behind.
    // Include soft-deleted portfolios (trash) so a user can't remove a currency
    // whose holdings would resurface broken when the portfolio is restored.
    const userPortfolios = await Portfolios.findAll({
      where: { userId },
      paranoid: false,
      attributes: ['id'],
      raw: true,
    });

    if (userPortfolios.length) {
      const holdingInCurrency = await Holdings.findOne({
        where: {
          currencyCode,
          portfolioId: userPortfolios.map((p) => p.id),
        },
        attributes: ['portfolioId'],
      });

      if (holdingInCurrency) {
        throw new ValidationError({
          message: t({
            key: 'userCurrencies.cannotDeleteCurrencyWithInvestments',
            variables: { currencyCode },
          }),
        });
      }
    }

    const defaultCurrency = await UsersCurrencies.getCurrency({
      userId,
      isDefaultCurrency: true,
    });

    if (!defaultCurrency) {
      throw new UnexpectedError({ message: t({ key: 'userCurrencies.defaultCurrencyNotPresent' }) });
    }

    await Transactions.updateTransactions(
      {
        currencyCode: defaultCurrency.currencyCode,
      },
      { userId, currencyCode: passedCurrency.currencyCode },
    );

    await UsersCurrencies.deleteCurrency({
      userId,
      currencyCode,
    });
  },
);
