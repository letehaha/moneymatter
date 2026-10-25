import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import * as UsersCurrencies from '@models/users-currencies.model';

import { withTransaction } from '../common/with-transaction';

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

    // ponytail: no unique index on (userId, currencyCode); a unique index + dedupe migration would make this lock unnecessary
    await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('users-currencies'), :userId)`, {
      replacements: { userId: currencies[0].userId },
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
