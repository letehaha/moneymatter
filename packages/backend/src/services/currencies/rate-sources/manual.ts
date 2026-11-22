import UserExchangeRates from '@models/user-exchange-rates.model';
import { Op, type Order } from 'sequelize';

/**
 * The rates of a custom currency live in `UserExchangeRates`, one row per start day in any ISO quote.
 * A day takes the row that started most recently on or before it.
 */
const LATEST_FIRST: Order = [
  ['effectiveDate', 'DESC'],
  ['date', 'DESC'],
];

const EARLIEST_FIRST: Order = [
  ['effectiveDate', 'ASC'],
  ['date', 'DESC'],
];

/** Every stored rate of a custom code (any quote), latest first, one page at a time. */
export const listStoredCustomRates = async ({
  userId,
  baseCode,
  limit,
  offset,
}: {
  userId: number;
  baseCode: string;
  limit: number;
  offset: number;
}) => {
  return UserExchangeRates.findAll({
    where: { userId, baseCode },
    order: LATEST_FIRST,
    limit,
    offset,
    raw: true,
  });
};

/** How many rates the user stored for a custom code, in any quote. */
export const countStoredCustomRates = async ({ userId, baseCode }: { userId: number; baseCode: string }) => {
  return UserExchangeRates.count({ where: { userId, baseCode } });
};

/**
 * The user's stored rate for a custom code on a day, in whichever quote it was entered in. A day
 * before the first rate takes the earliest one, so a custom currency with any rate is valued on
 * every day. `null` only when it has no rate at all.
 */
export const findStoredCustomRate = async ({
  userId,
  baseCode,
  asOfDate,
}: {
  userId: number;
  baseCode: string;
  asOfDate: string;
}) => {
  const where = { userId, baseCode, rate: { [Op.gt]: 0 } };

  return (
    (await UserExchangeRates.findOne({
      where: { ...where, effectiveDate: { [Op.lte]: asOfDate } },
      order: LATEST_FIRST,
      raw: true,
    })) ?? UserExchangeRates.findOne({ where, order: EARLIEST_FIRST, raw: true })
  );
};
