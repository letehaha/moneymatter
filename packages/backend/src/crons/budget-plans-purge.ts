import { logger } from '@js/utils';
import BudgetPlans from '@models/budget-plans.model';
import { CronJob } from 'cron';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

export const BUDGET_PLAN_TRASH_RETENTION_DAYS = 30;

/**
 * One statement on purpose: find-the-ids-then-delete could race a restore
 * between the two queries and purge a plan the user just brought back.
 * Children cascade.
 */
const purgeExpiredPlans = (): Promise<number> =>
  BudgetPlans.destroy({
    force: true,
    where: { deletedAt: { [Op.lt]: subDays(new Date(), BUDGET_PLAN_TRASH_RETENTION_DAYS) } },
  });

/** Schedule: 04:00 UTC daily, staggered after the other retention sweeps. */
class BudgetPlansPurgeCronService {
  private job: CronJob | null = null;

  public startCron(): void {
    if (this.job) {
      logger.info('Budget plans purge cron is already running');
      return;
    }

    this.job = new CronJob(
      '0 4 * * *',
      async () => {
        try {
          const purged = await purgeExpiredPlans();
          logger.info('Purge of soft-deleted budget plans completed', { purged });
        } catch (error) {
          // Stable code so Sentry groups by failure mode, not by stack-trace fingerprint.
          logger.error(
            { message: 'Scheduled purge of soft-deleted budget plans failed', error: error as Error },
            { code: 'BUDGET_PLANS_PURGE_CRON_FAILED' },
          );
        }
      },
      null,
      false,
      'UTC',
    );

    this.job.start();
    logger.info('Budget plans purge cron started — runs daily at 04:00 UTC');
  }

  public stopCron(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info('Budget plans purge cron stopped');
    }
  }

  /** Manual trigger — used by tests instead of waiting on the schedule. */
  public triggerManualCheck(): Promise<number> {
    return purgeExpiredPlans();
  }
}

export const budgetPlansPurgeCron = new BudgetPlansPurgeCronService();
