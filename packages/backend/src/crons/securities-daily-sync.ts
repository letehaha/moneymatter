import { securitiesPricesStocksDailySync } from '@root/services/investments/securities-price/securities-daily-sync.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily stock price sync — runs at 6:00 AM EST (after global markets close).
 *
 * Timing ensures:
 *   - US markets closed (4 PM EST previous day)
 *   - European markets closed (5:30 PM GMT previous day)
 *   - Asian markets closed (varies, but generally by 9 AM local time)
 */
export const securitiesDailySyncCron = createScheduledSync({
  name: 'securities daily prices sync',
  cronExpression: '0 6 * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'runs every day at 6:00 AM EST',
  run: securitiesPricesStocksDailySync,
});
