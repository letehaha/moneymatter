import { cleanupExpiredDemoUsers } from '@services/demo/cleanup-demo-users.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const demoCleanupCron = createScheduledSync({
  name: 'demo user cleanup',
  cronExpression: '0 0,4,8,12,16,20 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs every 4 hours',
  run: async () => ({ cleaned: await cleanupExpiredDemoUsers() }),
});
