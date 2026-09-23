import { RecordId } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';

/** Soft delete. */
const deletePlanImpl = async ({ userId, planId }: { userId: number; planId: RecordId }): Promise<void> => {
  const plan = await findPlan({ planId, userId, lock: true });
  await plan.destroy();
};

export const deletePlan = withTransaction(deletePlanImpl);
