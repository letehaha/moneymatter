import { withLock } from '@services/common/lock';
import { syncCoingeckoRates } from '@services/currencies/rate-sources/coingecko-sync';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily rates of the currencies whose rate source is CoinGecko (UTC).
 *
 * Runs just after midnight UTC, so the stored rate of a day is the price at its start, the same
 * point of the day the history backfill stores. A run fetches each coin once for all users, spaced
 * to stay under the Demo plan's per-minute limit, so the lock outlasts the longest plausible run.
 */
export const coingeckoRatesSyncCron = createScheduledSync({
  name: 'coingecko currency rates sync',
  cronExpression: '30 0 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 00:30 UTC',
  errorCode: 'COINGECKO_RATES_SYNC_CRON',
  run: withLock('lock:cron:coingecko-rates-sync', () => syncCoingeckoRates(), { ttl: 60 * 60 * 2 }),
});
