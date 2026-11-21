import { TRACKER_STATUSES } from '@bt/shared/types';
import Trackers from '@models/trackers.model';
import { enqueueTrackerScan } from '@services/trackers/smart-tracking/tracker-scan-queue';
import { Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';
import { trackerNotLongEndedWhere, trackerOwnerActiveWhere } from './lib/tracker-owner-active-where';

/** Queues a scan for every smart tracker still in range whose owner signed in recently. */
export const runTrackerSmartScanCron = async ({ now = new Date() }: { now?: Date } = {}) => {
  const trackers = await Trackers.findAll({
    where: {
      aiEnabled: true,
      status: { [Op.ne]: TRACKER_STATUSES.archived },
      startDate: { [Op.ne]: null },
      [Op.and]: [trackerNotLongEndedWhere({ now }), trackerOwnerActiveWhere({ now })],
    },
    attributes: ['id'],
  });

  for (const tracker of trackers) await enqueueTrackerScan({ trackerId: tracker.id });

  return { due: trackers.length };
};

export const trackerSmartScanCron = createScheduledSync({
  name: 'tracker smart scan',
  cronExpression: '15 4 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 4:15 AM UTC',
  errorCode: 'TRACKER_SMART_SCAN_CRON',
  run: () => runTrackerSmartScanCron(),
});
