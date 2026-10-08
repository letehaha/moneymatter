import { minutesToCronExpression } from '@common/utils/minutes-to-cron';
import { logger } from '@js/utils';
import { securitiesPricesCryptoSync } from '@root/services/investments/securities-price/securities-daily-sync.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

const DEFAULT_INTERVAL_MINUTES = 15;

interface ResolvedSchedule {
  intervalMinutes: number;
  cronExpression: string;
}

/**
 * `minutesToCronExpression` returns `null` when the cadence can't be expressed
 * cleanly. We treat that as "use the default": a bad env value should warn and
 * degrade, not crash the worker boot.
 */
const resolveSchedule = (): ResolvedSchedule => {
  const fallback: ResolvedSchedule = {
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    cronExpression: minutesToCronExpression({ minutes: DEFAULT_INTERVAL_MINUTES }) as string,
  };

  const raw = process.env.CRYPTO_PRICES_SYNC_INTERVAL_MINUTES;
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  const cronExpression = minutesToCronExpression({ minutes: parsed });
  if (!cronExpression) {
    logger.warn(
      `Invalid CRYPTO_PRICES_SYNC_INTERVAL_MINUTES="${raw}". Expected a positive integer that ` +
        `maps to a uniform cron schedule: 1–59 (sub-hour), 60, multiples of 60 up to 1380 ` +
        `(2h..23h), or 1440 (daily). Falling back to ${DEFAULT_INTERVAL_MINUTES} minutes.`,
    );
    return fallback;
  }

  return { intervalMinutes: parsed, cronExpression };
};

const { intervalMinutes, cronExpression } = resolveSchedule();

/**
 * Crypto intraday price sync (UTC).
 *
 * Crypto markets are 24/7 and CoinGecko's `last_updated_at` typically ticks
 * every few minutes for active coins. Cadence is tuned via
 * `CRYPTO_PRICES_SYNC_INTERVAL_MINUTES` so quota cost can be balanced against
 * freshness per environment — the CoinGecko Demo plan caps at 10k calls/month,
 * so at one batch per run a 15-minute cadence sits at ~2.9k/month.
 */
export const cryptoPricesSyncCron = createScheduledSync({
  name: 'crypto prices sync',
  cronExpression,
  timeZone: 'UTC',
  scheduleDescription: `runs every ${intervalMinutes} minutes (UTC)`,
  run: securitiesPricesCryptoSync,
});
