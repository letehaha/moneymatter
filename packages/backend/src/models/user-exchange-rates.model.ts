import { UserExchangeRatesModel } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { NotFoundError, ValidationError } from '@js/errors';
import { Op } from 'sequelize';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import * as Currencies from './currencies.model';
import * as UsersCurrencies from './users-currencies.model';
import Users from './users.model';

type UserExchangeRatesAttributes = Omit<UserExchangeRatesModel, 'custom'>;

@Table({
  timestamps: true,
  createdAt: 'date',
  updatedAt: false,
  tableName: 'UserExchangeRates',
  freezeTableName: true,
})
export default class UserExchangeRates extends Model {
  @ForeignKey(() => Users)
  @Column({ allowNull: false, type: DataType.INTEGER, primaryKey: true })
  userId!: number;

  @ForeignKey(() => Currencies.default)
  @Column({ allowNull: false, type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), primaryKey: true })
  baseCode!: string;

  @ForeignKey(() => Currencies.default)
  @Column({ allowNull: false, type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), primaryKey: true })
  quoteCode!: string;

  @Column({ allowNull: true, defaultValue: 1, type: DataType.NUMBER })
  rate!: number;

  @Column({ allowNull: false, type: DataType.DATE, primaryKey: true })
  date!: Date;

  // TODO:
  // 1. Add date fields to UserExchangeRates: "effectiveFrom", "effectiveTo"
  // 2. When updating rates:
  //  - Close current rate (set "effectiveTo")
  //  - Create new entry with current date as "effectiveFrom"
  // 3. For historical data:
  //  - Query UserExchangeRates with transaction date
  //  - Fall back to ExchangeRates if no user-specific rate
  // This approach will maintain the rate history for each user, allowing accurate historical calculations
}

export type ExchangeRatePair = Pick<UserExchangeRatesAttributes, 'baseCode' | 'quoteCode'>;

export async function getRates({
  userId,
  pair,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair: ExchangeRatePair;
});
export async function getRates({
  userId,
  pairs,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pairs: ExchangeRatePair[];
});
export async function getRates({
  userId,
  pair,
  pairs,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair?: ExchangeRatePair;
  pairs?: ExchangeRatePair[];
}) {
  const where: Record<string | symbol, unknown> = {
    userId,
  };

  if (pair && pairs) {
    throw new ValidationError({
      message: 'Only a single parameter is allowed. Passed both "pair" and "pairs".',
    });
  }
  if (!pair && !pairs) {
    throw new ValidationError({
      message: 'One of "pair" or "pairs" parameters is required.',
    });
  }

  if (pair) {
    where.baseCode = pair.baseCode;
    where.quoteCode = pair.quoteCode;
  } else if (pairs) {
    where[Op.or] = pairs.map((item) => ({
      [Op.and]: {
        baseCode: item.baseCode,
        quoteCode: item.quoteCode,
      },
    }));
  }

  return UserExchangeRates.findAll({
    where,
    raw: true,
    attributes: { exclude: ['userId'] },
  });
}

export type UpdateExchangeRatePair = Pick<UserExchangeRatesAttributes, 'baseCode' | 'quoteCode' | 'rate'>;

export async function updateRates({
  userId,
  pair,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair: UpdateExchangeRatePair;
}): Promise<UserExchangeRates[]>;
export async function updateRates({
  userId,
  pairs,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pairs: UpdateExchangeRatePair[];
}): Promise<UserExchangeRates[]>;
export async function updateRates({
  userId,
  pair,
  pairs,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair?: UpdateExchangeRatePair;
  pairs?: UpdateExchangeRatePair[];
}): Promise<UserExchangeRates[]> {
  const iterations = (pairs ?? [pair]) as UpdateExchangeRatePair[];
  const returningValues: UserExchangeRates[] = [];

  for (const pairItem of iterations) {
    const foundItem = await UserExchangeRates.findOne({
      where: {
        userId,
        baseCode: pairItem.baseCode,
        quoteCode: pairItem.quoteCode,
      },
      raw: true,
    });

    if (foundItem) {
      const [, updatedItems] = await UserExchangeRates.update(
        {
          rate: pairItem.rate,
        },
        {
          where: {
            userId,
            baseCode: pairItem.baseCode,
            quoteCode: pairItem.quoteCode,
          },
          returning: true,
        },
      );

      const currency = (await Currencies.default.findOne({
        where: { code: pairItem.baseCode },
        raw: true,
        attributes: ['code'],
      }))!;

      await UsersCurrencies.default.update(
        { liveRateUpdate: false },
        { where: { userId, currencyCode: currency.code } },
      );

      if (updatedItems[0]) returningValues.push(updatedItems[0]);
    } else {
      const currencies = await Currencies.getCurrencies({
        codes: [pairItem.baseCode, pairItem.quoteCode],
      });
      const userCurrencies = await UsersCurrencies.getCurrencies({
        userId,
        codes: currencies.map((i) => i.code),
      });

      if (currencies.length !== userCurrencies.length) {
        throw new NotFoundError({
          message: 'Cannot find currencies to update rates for. Make sure wanted currencies are assigned to the user.',
        });
      }

      const baseCurrency = currencies.find((item) => item.code === pairItem.baseCode);
      const quoteCurrency = currencies.find((item) => item.code === pairItem.quoteCode);

      if (baseCurrency && quoteCurrency) {
        const res = await UserExchangeRates.create(
          {
            userId,
            rate: pairItem.rate,
            baseCode: baseCurrency.code,
            quoteCode: quoteCurrency.code,
          },
          {
            returning: true,
          },
        );

        const currency = (await Currencies.default.findOne({
          where: { code: pairItem.baseCode },
          raw: true,
          attributes: ['code'],
        }))!;
        await UsersCurrencies.default.update(
          { liveRateUpdate: false },
          { where: { userId, currencyCode: currency.code } },
        );

        returningValues.push(res);
      } else {
        throw new NotFoundError({
          message: 'Cannot find currencies to update rates for.',
        });
      }
    }
  }

  return returningValues;
}

export async function removeRates({
  userId,
  pairs,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pairs: ExchangeRatePair[];
}): Promise<void> {
  await UserExchangeRates.destroy({
    where: {
      [Op.or]: pairs.map((item) => ({
        [Op.and]: {
          userId,
          baseCode: item.baseCode,
          quoteCode: item.quoteCode,
        },
      })),
    },
  });
}
