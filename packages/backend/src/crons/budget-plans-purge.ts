import { BUDGET_PLAN_TRASH_RETENTION_DAYS } from '@bt/shared/types';
import BudgetPlans from '@models/budget-plans.model';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * One statement on purpose: find-the-ids-then-delete could race a restore
 * between the two queries and purge a plan the user just brought back.
 * Children cascade.
 */
const purgeExpiredPlans = async (): Promise<{ purged: number }> => ({
  purged: await BudgetPlans.destroy({
    force: true,
    where: { deletedAt: { [Op.lt]: subDays(new Date(), BUDGET_PLAN_TRASH_RETENTION_DAYS) } },
  }),
});

/** Schedule: 04:00 UTC daily, staggered after the other retention sweeps. */
export const budgetPlansPurgeCron = createScheduledSync({
  name: 'purge of soft-deleted budget plans',
  cronExpression: '0 4 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 04:00 UTC',
  errorCode: 'BUDGET_PLANS_PURGE_CRON',
  run: purgeExpiredPlans,
});
