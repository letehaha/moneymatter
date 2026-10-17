import UserExchangeRates from '@models/user-exchange-rates.model';
import { Op, type Order } from 'sequelize';

/**
 * Manual rates (and the rows the synced sources write) live in `UserExchangeRates`, one row per pair
 * and start day. A day takes the row that started most recently on or before it, and the one
 * written last when several start on the same day. A day before the first row has no rate.
 */
const LATEST_FIRST: Order = [
  ['effectiveDate', 'DESC'],
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

/** The user's stored rate for exactly this pair on a day. */
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
    where: { userId, baseCode, quoteCode, effectiveDate: { [Op.lte]: asOfDate } },
    order: LATEST_FIRST,
    raw: true,
  });
};

/**
 * The user's stored rate for a custom code on a day, in whichever quote currency it was entered in
 * and skipping rates that quote a code in `excludedQuotes`. The rate stays in that quote, so a
 * base-currency change never rewrites it.
 */
export const findStoredCustomRate = async ({
  userId,
  baseCode,
  asOfDate,
  excludedQuotes,
}: {
  userId: number;
  baseCode: string;
  asOfDate: string;
  excludedQuotes: readonly string[];
}) => {
  return UserExchangeRates.findOne({
    where: { userId, baseCode, quoteCode: { [Op.notIn]: excludedQuotes }, effectiveDate: { [Op.lte]: asOfDate } },
    order: LATEST_FIRST,
    raw: true,
  });
};
