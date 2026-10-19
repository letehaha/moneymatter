import { BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import { connection } from '@models/connection';
import { TRACKER_SCAN_ENDED_GRACE_DAYS } from '@services/budgets/smart-tracking/run-tracker-scan';
import { enqueueTrackerScan } from '@services/budgets/smart-tracking/tracker-scan-queue';
import { subDays } from 'date-fns';
import { Op, literal } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

const ACTIVE_WITHIN_DAYS = 30;

/** Queues a scan for every smart tracker still in range whose owner signed in recently. */
export const runTrackerSmartScanCron = async ({ now = new Date() }: { now?: Date } = {}) => {
  const activeSince = connection.sequelize.escape(subDays(now, ACTIVE_WITHIN_DAYS));
  const budgets = await Budgets.findAll({
    where: {
      aiEnabled: true,
      type: BUDGET_TYPES.manual,
      status: { [Op.ne]: BUDGET_STATUSES.archived },
      startDate: { [Op.ne]: null },
      [Op.and]: [
        { [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: subDays(now, TRACKER_SCAN_ENDED_GRACE_DAYS) } }] },
        literal(
          `"Budgets"."userId" IN (SELECT u."id" FROM "Users" u JOIN ba_session s ON s."userId" = u."authUserId" WHERE s."updatedAt" >= ${activeSince})`,
        ),
      ],
    },
    attributes: ['id'],
  });

  for (const budget of budgets) await enqueueTrackerScan({ budgetId: budget.id });

  return { due: budgets.length };
};

export const trackerSmartScanCron = createScheduledSync({
  name: 'tracker smart scan',
  cronExpression: '15 4 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 4:15 AM UTC',
  errorCode: 'TRACKER_SMART_SCAN_CRON',
  run: () => runTrackerSmartScanCron(),
});
