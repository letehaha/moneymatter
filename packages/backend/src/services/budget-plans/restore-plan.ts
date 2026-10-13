import { RecordId } from '@bt/shared/types';
import { BudgetPlanDetails } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import BudgetPlans from '@models/budget-plans.model';
import { withTransaction } from '@services/common/with-transaction';

import { asOnlyActivePlan, requireBaseCurrencyCode } from './create-plan';
import { findPlan, lockPlansByIds } from './find-plan';
import { getPlan } from './get-plan';

const restorePlanImpl = async ({
  userId,
  planId,
  replace = false,
}: {
  userId: number;
  planId: RecordId;
  replace?: boolean;
}): Promise<BudgetPlanDetails> => {
  const activeId = replace ? (await BudgetPlans.findOne({ where: { userId }, attributes: ['id'] }))?.id : undefined;
  // Both rows are locked in id order first, so two opposite swaps cannot deadlock.
  const locked = activeId && activeId !== planId ? await lockPlansByIds({ planIds: [planId, activeId], userId }) : [];
  const active = locked.find((candidate) => candidate.id === activeId);

  const plan = await findPlan({ planId, userId, lock: true, includeDeleted: true });
  if (!plan.deletedAt) return getPlan({ userId, planId });

  if ((await requireBaseCurrencyCode({ userId })) !== plan.currencyCode) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.baseCurrencyChanged' }) });
  }

  if (active && !active.deletedAt) await active.destroy();
  await asOnlyActivePlan({ write: plan.restore() });

  return getPlan({ userId, planId });
};

export const restorePlan = withTransaction(restorePlanImpl);
