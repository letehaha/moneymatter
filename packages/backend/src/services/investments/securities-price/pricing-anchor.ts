import { PriceData } from '../data-providers/base-provider';

/**
 * Midnight UTC of the given date (00:00:00 UTC of the same calendar day in UTC).
 *
 * Stocks daily-sync, historical backfill and the first price written when a
 * security is added all anchor rows here so the unique `(securityId, date)` index
 * dedupes per UTC day regardless of when the write actually happened. Crypto
 * prices deliberately do NOT use this outside backfill — they keep the provider's
 * intraday timestamp so multiple snapshots per day coexist.
 */
export const startOfDayUtc = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Collapse a list of historical prices into one row per UTC day, anchored at
 * midnight UTC of that day. Picks the latest-timestamp point within each day.
 *
 * Backfill stays daily (one row per security per day) regardless of provider
 * granularity. CoinGecko may return multiple intraday points for short ranges,
 * and Yahoo's per-day timestamps vary by exchange close; this normalizes both
 * to the same anchor the going-forward stock cron writes.
 */
export const bucketByUtcDay = <T extends PriceData>(prices: T[]): T[] => {
  const byDay = new Map<string, T>();
  for (const price of prices) {
    const dayKey = startOfDayUtc(price.date).toISOString();
    const existing = byDay.get(dayKey);
    if (!existing || price.date > existing.date) {
      byDay.set(dayKey, price);
    }
  }
  return Array.from(byDay.values()).map((price) => ({
    ...price,
    date: startOfDayUtc(price.date),
  }));
};
