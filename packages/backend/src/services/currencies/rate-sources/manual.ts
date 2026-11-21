import UserExchangeRates from '@models/user-exchange-rates.model';
import { Op, type Order } from 'sequelize';

/**
 * Manual rates (and the rows the synced sources write) live in `UserExchangeRates`, one row per pair
 * and start day. A day takes the row that started most recently on or before it, and the one
 * written last when several start on the same day.
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

/** The user's stored rate for exactly this pair on a day; `null` before the pair's first rate. */
export const findStoredPairRate = async ({
  userId,
  baseCode,
  quoteCode,
  asOfDate,
}: {
  userId: number;
  baseCode: string;
  quoteCode: string;
  asOfDate: string;
}) => {
  return UserExchangeRates.findOne({
    where: { userId, baseCode, quoteCode, rate: { [Op.gt]: 0 }, effectiveDate: { [Op.lte]: asOfDate } },
    order: LATEST_FIRST,
    raw: true,
  });
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
