import { type UserExchangeRateSource, UserExchangeRatesModel } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { NotFoundError, ValidationError } from '@js/errors';
import { Op } from 'sequelize';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import * as Currencies from './currencies.model';
import * as UsersCurrencies from './users-currencies.model';
import Users from './users.model';

type UserExchangeRatesAttributes = Omit<UserExchangeRatesModel, 'custom'>;

/** UTC calendar day of a timestamp, as the `YYYY-MM-DD` text a DATEONLY column takes. */
export const toEffectiveDate = ({ date }: { date: Date }): string => date.toISOString().slice(0, 10);

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

  /** When the row was written. */
  @Column({ allowNull: false, type: DataType.DATE })
  date!: Date;

  /**
   * The calendar day the rate starts to apply. A custom currency is valued with the latest row on or
   * before the day of the conversion; a pair of ISO currencies has a single row, applied to every day.
   */
  @Column({ allowNull: false, type: DataType.DATEONLY, primaryKey: true })
  effectiveDate!: string;

  @Column({ allowNull: false, type: DataType.STRING(32), defaultValue: 'manual' })
  source!: UserExchangeRateSource;
}

export type ExchangeRatePair = Pick<UserExchangeRatesAttributes, 'baseCode' | 'quoteCode'> & {
  /** Narrows a removal to the rate that starts on this day (`YYYY-MM-DD`). */
  effectiveDate?: string;
};

/**
 * The user's stored rates for one or several pairs, the latest first: by `effectiveDate`, then by the
 * moment the row was written. With `asOfDate` only rates that start on or before that day (`YYYY-MM-DD`)
 * are returned, so the first row is the one in force on it.
 */
export async function getRates({
  userId,
  pair,
  asOfDate,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair: ExchangeRatePair;
  asOfDate?: string;
});
export async function getRates({
  userId,
  pairs,
  asOfDate,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pairs: ExchangeRatePair[];
  asOfDate?: string;
});
export async function getRates({
  userId,
  pair,
  pairs,
  asOfDate,
}: {
  userId: UserExchangeRatesAttributes['userId'];
  pair?: ExchangeRatePair;
  pairs?: ExchangeRatePair[];
  asOfDate?: string;
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
  if (asOfDate) where.effectiveDate = { [Op.lte]: asOfDate };

  return UserExchangeRates.findAll({
    where,
    raw: true,
    attributes: { exclude: ['userId'] },
    order: [
      ['effectiveDate', 'DESC'],
      ['date', 'DESC'],
    ],
  });
}

export type UpdateExchangeRatePair = Pick<UserExchangeRatesAttributes, 'baseCode' | 'quoteCode' | 'rate'> & {
  /**
   * The day (`YYYY-MM-DD`) the rate starts to apply; today when omitted. Only a pair with a custom
   * currency takes one: an ISO pair has a single rate that applies to every day.
   */
  effectiveDate?: string;
};

/**
 * Stop the user's connected-currency flag from letting the market overwrite a rate they just set. An
 * ISO currency's rate source follows the flag, so it moves to the user's own rates too; a custom
 * currency keeps the source it has.
 */
const disableLiveRates = async ({ userId, baseCode }: { userId: number; baseCode: string }): Promise<void> => {
  const currency = (await Currencies.default.findOne({
    where: { code: baseCode },
    raw: true,
    attributes: ['code', 'isCustom'],
  }))!;

  await UsersCurrencies.default.update(
    { liveRateUpdate: false, ...(currency.isCustom ? {} : { rateSource: 'manual' as const }) },
    { where: { userId, currencyCode: currency.code } },
  );
};

/**
 * Write a rate that applies from one day on. An existing rate of the same pair and day is replaced
 * and every other day is left alone.
 */
const writeDatedRate = async ({
  userId,
  pairItem,
}: {
  userId: number;
  pairItem: UpdateExchangeRatePair;
}): Promise<UserExchangeRates> => {
  const effectiveDate = pairItem.effectiveDate ?? toEffectiveDate({ date: new Date() });
  const where = { userId, baseCode: pairItem.baseCode, quoteCode: pairItem.quoteCode, effectiveDate };

  const [, updatedItems] = await UserExchangeRates.update(
    { rate: pairItem.rate, source: 'manual' },
    { where, returning: true },
  );
  if (updatedItems[0]) return updatedItems[0];

  return UserExchangeRates.create({ ...where, rate: pairItem.rate, source: 'manual' }, { returning: true });
};

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
    const currencies = await Currencies.getCurrencies({
      codes: [pairItem.baseCode, pairItem.quoteCode],
    });
    const isDatedPair = currencies.some((item) => item.isCustom);

    if (pairItem.effectiveDate && !isDatedPair) {
      throw new ValidationError({
        message: `The rate of ${pairItem.baseCode}/${pairItem.quoteCode} applies to every day: only a pair with a custom currency takes an effective date.`,
      });
    }

    const foundItem = isDatedPair
      ? null
      : await UserExchangeRates.findOne({
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

      await disableLiveRates({ userId, baseCode: pairItem.baseCode });

      if (updatedItems[0]) returningValues.push(updatedItems[0]);
    } else {
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
        const res = isDatedPair
          ? await writeDatedRate({ userId, pairItem })
          : await UserExchangeRates.create(
              {
                userId,
                rate: pairItem.rate,
                baseCode: baseCurrency.code,
                quoteCode: quoteCurrency.code,
                effectiveDate: toEffectiveDate({ date: new Date() }),
              },
              {
                returning: true,
              },
            );

        await disableLiveRates({ userId, baseCode: pairItem.baseCode });

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

/** Remove the user's rates of the pairs; a pair that names an `effectiveDate` loses only that day's rate. */
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
          ...(item.effectiveDate ? { effectiveDate: item.effectiveDate } : {}),
        },
      })),
    },
  });
}
