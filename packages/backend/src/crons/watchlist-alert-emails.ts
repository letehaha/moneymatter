import { sendWatchlistAlertEmails } from '@services/investments/watchlist/send-watchlist-alert-emails';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const watchlistAlertEmailsCron = createScheduledSync({
  name: 'watchlist alert emails',
  cronExpression: '*/30 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs every 30 minutes',
  errorCode: 'WATCHLIST_ALERT_EMAILS_CRON',
  run: sendWatchlistAlertEmails,
});
