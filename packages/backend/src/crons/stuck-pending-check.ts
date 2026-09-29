import { notifyStuckPending } from '@services/transactions/reconciliation/notify-stuck-pending';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const stuckPendingCheckCron = createScheduledSync({
  name: 'stuck pending check',
  cronExpression: '0 7 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 7:00 AM UTC',
  run: async () => {
    const { usersChecked, notified, failed, errors } = await notifyStuckPending();
    return { totalProcessed: usersChecked, successfulUpdates: notified, failedUpdates: failed, errors };
  },
});
