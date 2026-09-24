import { RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import { namespace } from '@models/connection';

interface FindPlanParams {
  planId: RecordId;
  userId: number;
  /** The overlap check is not expressible as a DB constraint, so the plan row serializes every write. */
  lock?: boolean;
  includeDeleted?: boolean;
}

const queryPlan = ({ planId, userId, lock = false, includeDeleted = false }: FindPlanParams) => {
  const transaction = namespace.get('transaction');
  if (lock && !transaction) throw new Error('Locking a budget plan requires a CLS transaction');

  return BudgetPlans.findOne({
    where: { id: planId, userId },
    paranoid: !includeDeleted,
    transaction,
    lock: lock ? transaction?.LOCK.NO_KEY_UPDATE : undefined,
  });
};

export const findPlan = (params: FindPlanParams): Promise<BudgetPlans> =>
  findOrThrowNotFound({ query: queryPlan(params), message: t({ key: 'budgetPlans.planNotFound' }) });

export const findLine = ({ planId, lineId }: { planId: RecordId; lineId: RecordId }): Promise<BudgetLines> =>
  findOrThrowNotFound({
    query: BudgetLines.findOne({ where: { id: lineId, planId } }),
    message: t({ key: 'budgetPlans.lineNotFound' }),
  });

export const findGroup = ({ planId, groupId }: { planId: RecordId; groupId: RecordId }): Promise<BudgetLineGroups> =>
  findOrThrowNotFound({
    query: BudgetLineGroups.findOne({ where: { id: groupId, planId } }),
    message: t({ key: 'budgetPlans.groupNotFound' }),
  });

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
  const plans: BudgetPlans[] = [];

  for (const planId of planIds.toSorted()) {
    const plan = await queryPlan({ planId, userId, lock: true, includeDeleted: true });
    if (plan) plans.push(plan);
  }

  return plans;
};
