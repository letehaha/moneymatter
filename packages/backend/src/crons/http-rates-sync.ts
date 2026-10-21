import { withLock } from '@services/common/lock';
import { syncHttpRates } from '@services/currencies/rate-sources/http-sync';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily rates of the currencies whose rate source is an HTTP endpoint (UTC).
 *
 * Runs at 00:45 UTC, after the CoinGecko sync, so the stored rate of a day is the one the endpoint
 * serves at the start of it. Every request has a 5-second timeout, so the lock outlasts any
 * plausible run.
 */
export const httpRatesSyncCron = createScheduledSync({
  name: 'http currency rates sync',
  cronExpression: '45 0 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 00:45 UTC',
  errorCode: 'HTTP_RATES_SYNC_CRON',
  run: withLock('lock:cron:http-rates-sync', () => syncHttpRates(), { ttl: 60 * 60 }),
});
