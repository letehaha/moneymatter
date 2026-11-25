import type { RecordId } from '@bt/shared/types';
import { connection } from '@models/connection';
import { startOfDayUtc } from '@services/investments/securities-price/pricing-anchor';
import { subDays } from 'date-fns';
import { QueryTypes } from 'sequelize';

interface DailyClose {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** Decimal string. */
  price: string;
}

export interface SecurityDailyCloses {
  last: DailyClose;
  previous: DailyClose | null;
}

/** Older closes are stale for display and alerts, and the bound keeps hourly crypto rows out of the scan. */
const CLOSE_LOOKBACK_DAYS = 14;

/**
 * The last two daily closes per security: the last price row of each completed UTC day.
 * Today is excluded, so crypto's intraday snapshots and a backfill's partial bar never count as a close.
 */
export const getDailyCloses = async ({
  securityIds,
  since = subDays(new Date(), CLOSE_LOOKBACK_DAYS),
}: {
  securityIds: RecordId[];
  since?: Date;
}): Promise<Map<RecordId, SecurityDailyCloses>> => {
  const result = new Map<RecordId, SecurityDailyCloses>();
  if (!securityIds.length) return result;

  const rows = (await connection.sequelize.query(
    `SELECT "securityId", "day", "priceClose", "rn" FROM (
       SELECT "securityId", "day", "priceClose",
              ROW_NUMBER() OVER (PARTITION BY "securityId" ORDER BY "day" DESC) AS "rn"
       FROM (
         SELECT DISTINCT ON ("securityId", ("date" AT TIME ZONE 'UTC')::date)
                "securityId", to_char(("date" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS "day", "priceClose"
         FROM "SecurityPricings"
         WHERE "securityId" IN (:securityIds) AND "date" >= :since AND "date" < :before
         ORDER BY "securityId", ("date" AT TIME ZONE 'UTC')::date DESC, "date" DESC
       ) daily
     ) ranked
     WHERE "rn" <= 2`,
    {
      type: QueryTypes.SELECT,
      replacements: { securityIds, before: startOfDayUtc(new Date()), since },
    },
  )) as { securityId: RecordId; day: string; priceClose: string; rn: string | number }[];

  for (const row of rows.toSorted((a, b) => Number(a.rn) - Number(b.rn))) {
    const close = { day: row.day, price: row.priceClose };
    const existing = result.get(row.securityId);
    if (existing) existing.previous = close;
    else result.set(row.securityId, { last: close, previous: null });
  }
  return result;
};

/** A 52-week range needs history reaching back that far; a week of slack covers weekends and a one-year backfill. */
const RANGE_DAYS = 365;
const RANGE_HISTORY_SLACK_DAYS = 7;

export const get52WeekRanges = async ({
  securityIds,
}: {
  securityIds: RecordId[];
}): Promise<Map<RecordId, { low: string; high: string }>> => {
  const result = new Map<RecordId, { low: string; high: string }>();
  if (!securityIds.length) return result;

  const today = startOfDayUtc(new Date());
  const rows = (await connection.sequelize.query(
    `SELECT "securityId", MIN("priceClose") AS "low", MAX("priceClose") AS "high",
            (SELECT MIN(first."date") FROM "SecurityPricings" first WHERE first."securityId" = ranged."securityId") AS "firstDate"
     FROM "SecurityPricings" ranged
     WHERE "securityId" IN (:securityIds) AND "date" >= :rangeStart AND "date" < :before
     GROUP BY "securityId"`,
    {
      type: QueryTypes.SELECT,
      replacements: { securityIds, before: today, rangeStart: subDays(today, RANGE_DAYS) },
    },
  )) as { securityId: RecordId; low: string | null; high: string | null; firstDate: Date | string }[];

  const historyCutoff = subDays(today, RANGE_DAYS - RANGE_HISTORY_SLACK_DAYS);
  for (const row of rows) {
    if (row.low === null || row.high === null || new Date(row.firstDate) > historyCutoff) continue;
    result.set(row.securityId, { low: row.low, high: row.high });
  }
  return result;
};
