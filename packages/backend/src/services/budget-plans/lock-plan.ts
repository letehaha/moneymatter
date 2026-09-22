import { RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import BudgetPlans from '@models/budget-plans.model';
import { namespace } from '@models/connection';

/**
 * The overlap check is not expressible as a DB constraint, so the plan row is
 * the serialization point for every write.
 */
export const lockPlan = async ({
  planId,
  userId,
  includeDeleted = false,
}: {
  planId: RecordId;
  userId: number;
  includeDeleted?: boolean;
}): Promise<BudgetPlans> => {
  const transaction = namespace.get('transaction');

  return findOrThrowNotFound({
    query: BudgetPlans.findOne({
      where: { id: planId, userId },
      paranoid: !includeDeleted,
      transaction,
      lock: transaction?.LOCK.NO_KEY_UPDATE,
    }),
    message: t({ key: 'budgetPlans.planNotFound' }),
  });
};

/**
 * The category-delete merge reaches plans by their lines, soft-deleted ones
 * included. One statement per plan, ascending: Postgres ignores ORDER BY when
 * taking locks, so a single statement could deadlock two merges.
 */
export const lockPlansByIds = async ({
  planIds,
  userId,
}: {
  planIds: RecordId[];
  userId: number;
}): Promise<BudgetPlans[]> => {
  const transaction = namespace.get('transaction');
  const plans: BudgetPlans[] = [];

  for (const planId of planIds.toSorted()) {
    const plan = await BudgetPlans.findOne({
      where: { id: planId, userId },
      paranoid: false,
      transaction,
      lock: transaction?.LOCK.NO_KEY_UPDATE,
    });
    if (plan) plans.push(plan);
  }

  return plans;
};
