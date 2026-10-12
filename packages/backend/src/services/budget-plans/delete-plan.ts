import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import BudgetPlans from '@models/budget-plans.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { findPlan } from './find-plan';

/** Soft delete. */
const deletePlanImpl = async ({ userId, planId }: { userId: number; planId: RecordId }): Promise<void> => {
  const plan = await findPlan({ planId, userId, lock: true });
  await plan.destroy();
};

export const deletePlan = withTransaction(deletePlanImpl);

/** Hard delete, trash only: an active plan answers 404, so no single request skips the trash. Children cascade. */
export const purgePlan = async ({ userId, planId }: { userId: number; planId: RecordId }): Promise<void> => {
  const purged = await BudgetPlans.destroy({
    force: true,
    where: { id: planId, userId, deletedAt: { [Op.ne]: null } },
  });
  if (!purged) throw new NotFoundError({ message: t({ key: 'budgetPlans.planNotFound' }) });
};
