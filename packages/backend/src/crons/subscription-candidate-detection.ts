import { logger } from '@js/utils';
import Users from '@models/users.model';
import { runDetection } from '@services/subscriptions/detect-candidates';

import { createScheduledSync } from './lib/create-scheduled-sync';

const detectForAllUsers = async (): Promise<{ usersProcessed: number; failed: number }> => {
  const users = await Users.findAll({ attributes: ['id'], raw: true });
  const result = { usersProcessed: 0, failed: 0 };

  for (const user of users) {
    try {
      const candidates = await runDetection({ userId: user.id });
      if (candidates.length > 0) {
        logger.info(`[cron] Created ${candidates.length} candidates for user ${user.id}`);
      }
      result.usersProcessed++;
    } catch (error) {
      result.failed++;
      logger.error({
        message: `[cron] Failed to detect candidates for user ${user.id}`,
        error: error as Error,
      });
    }
  }

  return result;
};

export const subscriptionCandidateDetectionCron = createScheduledSync({
  name: 'subscription candidate detection',
  cronExpression: '0 3 1 * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs 1st of month at 3:00 AM UTC',
  run: detectForAllUsers,
});
