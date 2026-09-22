import { RecordId } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';

import { lockPlan } from './lock-plan';

/** Soft delete. */
const deletePlanImpl = async ({ userId, planId }: { userId: number; planId: RecordId }): Promise<void> => {
  const plan = await lockPlan({ planId, userId });
  await plan.destroy();
};

export const deletePlan = withTransaction(deletePlanImpl);
