import { RecordId } from '@bt/shared/types';
import { BudgetPlanDetails } from '@bt/shared/types/budget-plans';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { withTransaction } from '@services/common/with-transaction';

import { asOnlyActivePlan, requireBaseCurrencyCode } from './create-plan';
import { findPlan } from './find-plan';
import { getPlan } from './get-plan';

const restorePlanImpl = async ({
  userId,
  planId,
}: {
  userId: number;
  planId: RecordId;
}): Promise<BudgetPlanDetails> => {
  const plan = await findPlan({ planId, userId, lock: true, includeDeleted: true });
  if (!plan.deletedAt) return getPlan({ userId, planId });

  if ((await requireBaseCurrencyCode({ userId })) !== plan.currencyCode) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.baseCurrencyChanged' }) });
  }

  await asOnlyActivePlan({ write: plan.restore() });

  return getPlan({ userId, planId });
};

export const restorePlan = withTransaction(restorePlanImpl);
