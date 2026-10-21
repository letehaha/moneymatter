import type { RecordId } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';
import { deleteLogoImage } from '@services/logo-images/logo-images.service';

import { findGoal } from './get-goals';

const deleteGoalImpl = async ({ userId, goalId }: { userId: number; goalId: RecordId }): Promise<void> => {
  const goal = await findGoal({ userId, goalId, lock: true });

  if (goal.logoImageId) await deleteLogoImage({ id: goal.logoImageId });
  await goal.destroy();
};

export const deleteGoal = withTransaction(deleteGoalImpl);
