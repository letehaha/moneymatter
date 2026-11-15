import { sweepChatRetention } from '@services/chat/retention/sweep';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const chatRetentionCron = createScheduledSync({
  name: 'chat retention',
  cronExpression: '17 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs hourly at minute 17 UTC',
  errorCode: 'CHAT_RETENTION_CRON',
  run: sweepChatRetention,
});
