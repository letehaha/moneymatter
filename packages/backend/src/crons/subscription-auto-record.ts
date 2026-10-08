import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { processAutoRecordPeriods } from '@services/subscriptions/process-auto-record';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Hourly cron that books transactions for every due auto-record period.
 *
 * Runs every hour at :05 (offset from the reminders cron's :00 so the two are
 * not contending on the same Subscriptions/SubscriptionPeriods rows in the
 * same Postgres second). One tick per hour gives the auto path 24 chances to
 * book a same-day period before the reminders cron's overdue marker can reach
 * it — see `processAutoRecordPeriods` for the full race story.
 */
export const subscriptionAutoRecordCron = createScheduledSync({
  name: 'subscription auto-record run',
  cronExpression: '5 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs hourly',
  run: () => runWithBalanceRevalueBatch(processAutoRecordPeriods),
});
