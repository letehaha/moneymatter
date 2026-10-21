import { GOAL_STATUSES_HOLDING_SHARES, type GoalModel, type RecordId, type UpdateGoalPayload } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';
import { applyLogoWrite } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

import { syncSavedGoal } from './check-goals-reached';
import { findGoal } from './get-goals';
import { assertGoalCurrencyConvertible } from './goal-insights';
import { writeGoalShares } from './share-capacity';

type UpdateGoalParams = UpdateGoalPayload & { userId: number; goalId: RecordId };

/** Pause, archive and unarchive are status changes here. Archiving releases the shares; unarchiving re-checks them. */
const updateGoalImpl = withTransaction(
  async ({
    userId,
    goalId,
    accounts,
    status,
    currencyCode,
    targetAmount,
    plannedMonthly,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    ...fields
  }: UpdateGoalParams): Promise<void> => {
    const goal = await findGoal({ userId, goalId, lock: true });
    const currencyChanged = currencyCode !== undefined && currencyCode !== goal.currencyCode;

    if (currencyChanged) {
      await assertGoalCurrencyConvertible({ userId, currencyCode });
    }

    const nextStatus = status ?? goal.status;
    const unarchiving =
      !GOAL_STATUSES_HOLDING_SHARES.includes(goal.status) && GOAL_STATUSES_HOLDING_SHARES.includes(nextStatus);
    if (accounts !== undefined || unarchiving) {
      await writeGoalShares({ userId, goalId, status: nextStatus, shares: accounts });
    }

    const completionChanged =
      currencyChanged || (targetAmount !== undefined && !Money.fromDecimal(targetAmount).equals(goal.targetAmount));

    const logoPatch = await applyLogoWrite({
      write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage },
      stored: goal,
    });

    await goal.update({
      ...removeUndefinedKeys({
        ...fields,
        status,
        currencyCode,
        targetAmount: targetAmount === undefined ? undefined : Money.fromDecimal(targetAmount),
        plannedMonthly: plannedMonthly == null ? plannedMonthly : Money.fromDecimal(plannedMonthly),
      }),
      ...(completionChanged && { achievedAt: null, achievedAmount: null }),
      ...logoPatch,
    });
  },
);

/** The response is read after commit, so a rate gap in the insights can't roll back the write. */
export const updateGoal = async (params: UpdateGoalParams): Promise<GoalModel> => {
  await updateGoalImpl(params);
  return syncSavedGoal({ userId: params.userId, goalId: params.goalId });
};
