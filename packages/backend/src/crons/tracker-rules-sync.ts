import { TRACKER_STATUSES } from '@bt/shared/types';
import { logger } from '@js/utils';
import Trackers from '@models/trackers.model';
import { syncTrackerRules } from '@services/trackers/rules/sync-tracker-rules';
import { Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';
import { trackerNotLongEndedWhere, trackerOwnerActiveWhere } from './lib/tracker-owner-active-where';

/** Keeps rule-based trackers fresh for widgets between page visits, for owners who signed in recently. */
export const runTrackerRulesSyncCron = async ({ now = new Date() }: { now?: Date } = {}) => {
  const trackers = await Trackers.findAll({
    where: {
      rulesEnabled: true,
      status: { [Op.ne]: TRACKER_STATUSES.archived },
      [Op.and]: [trackerNotLongEndedWhere({ now }), trackerOwnerActiveWhere({ now })],
    },
    attributes: ['id'],
  });

  let failed = 0;
  for (const tracker of trackers) {
    try {
      await syncTrackerRules({ trackerId: tracker.id });
    } catch (error) {
      failed += 1;
      logger.error(
        { message: 'Tracker rules sync failed', error: error as Error },
        { code: 'TRACKER_RULES_SYNC_FAILED', trackerId: tracker.id },
      );
    }
  }

  if (failed) {
    logger.error(
      { message: `Tracker rules sync failed for ${failed} of ${trackers.length} trackers` },
      { code: 'TRACKER_RULES_SYNC_PARTIAL_FAILURE' },
    );
  }

  return { due: trackers.length, failed };
};

export const trackerRulesSyncCron = createScheduledSync({
  name: 'tracker rules sync',
  cronExpression: '30 */6 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs every 6 hours at minute 30 UTC',
  errorCode: 'TRACKER_RULES_SYNC_CRON',
  run: () => runTrackerRulesSyncCron(),
});
