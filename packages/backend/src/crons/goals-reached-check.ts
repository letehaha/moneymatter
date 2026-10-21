import { checkGoalsReached } from '@services/goals/check-goals-reached';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const goalsReachedCheckCron = createScheduledSync({
  name: 'goals reached check',
  cronExpression: '0 8 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 8:00 AM UTC',
  errorCode: 'GOALS_REACHED_CHECK_CRON',
  run: checkGoalsReached,
});
