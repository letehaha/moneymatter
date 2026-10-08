import { checkScheduledReminders } from '@services/tag-reminders/check-reminders';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily check of all scheduled tag reminders; each reminder is evaluated against
 * its own frequency preset (daily/weekly/monthly/quarterly/yearly).
 */
export const tagRemindersCron = createScheduledSync({
  name: 'tag reminders check',
  cronExpression: '0 7 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 7:00 AM UTC',
  run: checkScheduledReminders,
});
