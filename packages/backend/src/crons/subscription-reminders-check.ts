import { checkSubscriptionReminders } from '@services/subscriptions/check-subscription-reminders';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Every 2 hours: updates overdue period statuses and sends remind-before
 * notifications (in-app + email queue).
 */
export const subscriptionRemindersCron = createScheduledSync({
  name: 'subscription reminders check',
  cronExpression: '0 */2 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs every 2 hours',
  run: checkSubscriptionReminders,
});
