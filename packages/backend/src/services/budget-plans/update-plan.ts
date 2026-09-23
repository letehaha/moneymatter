import { RecordId } from '@bt/shared/types';
import { BudgetPlanCarryPolicy } from '@bt/shared/types/budget-plans';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPlan } from './get-plan';

/**
 * A new plan default reaches every period of every line without its own
 * setting, past ones included.
 */
const updatePlanImpl = async ({
  userId,
  planId,
  name,
  autoAttachAccounts,
  carryPolicy,
}: {
  userId: number;
  planId: RecordId;
  name?: string;
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
}) => {
  const plan = await findPlan({ planId, userId, lock: true });
  await plan.update(removeUndefinedKeys({ name, autoAttachAccounts, carryPolicy }));

  return getPlan({ userId, planId });
};

export const updatePlan = withTransaction(updatePlanImpl);
