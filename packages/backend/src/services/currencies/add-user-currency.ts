import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as UsersCurrencies from '@models/users-currencies.model';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from './assert-currency-codes-visible';

export const addUserCurrencies = withTransaction(
  async (
    currencies: {
      userId: number;
      currencyCode: string;
      exchangeRate?: number;
      liveRateUpdate?: boolean;
    }[],
  ) => {
    if (!currencies.length || !currencies[0]) {
      throw new ValidationError({ message: t({ key: 'currencies.listIsEmpty' }) });
    }

    // A custom code is attachable only by a user that already holds it (the custom-currency
    // endpoints create that row); this entry point never links someone else's definition.
    await assertCurrencyCodesVisible({
      userId: currencies[0].userId,
      codes: currencies.map((item) => item.currencyCode),
    });

    const existingCurrencies = await UsersCurrencies.getCurrencies({
      userId: currencies[0].userId,
    });
    const alreadyExistsCodes: string[] = [];

    existingCurrencies.forEach((item) => {
      const index = currencies.findIndex((currency) => currency.currencyCode === item.currencyCode);

      if (index >= 0) {
        alreadyExistsCodes.push(currencies[index]!.currencyCode);
        currencies.splice(index, 1);
      }
    });

    const result = await Promise.all(currencies.map((item) => UsersCurrencies.addCurrency(item)));

    return { currencies: result, alreadyExistingCodes: alreadyExistsCodes };
  },
);
