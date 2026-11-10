import { GOAL_STATUSES_HOLDING_SHARES, type GoalModel, type RecordId, type UpdateGoalPayload } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';
import { applyLogoWrite } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

import { syncSavedGoal } from './check-goals-reached';
import { findGoal } from './get-goals';
import { assertGoalCurrencyConvertible } from './goal-insights';
import { roundGoalAmount } from './round-goal-amount';
import { writeGoalShares } from './share-capacity';

type UpdateGoalParams = UpdateGoalPayload & { userId: number; goalId: RecordId };

/** Pause, archive and unarchive are status changes here. Archiving releases the shares; unarchiving re-checks and re-places them. */
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

    // Sent amounts are in the goal's (possibly new) currency and round half-up to its decimals.
    const round = ({ amount }: { amount: number }) =>
      roundGoalAmount({ money: Money.fromDecimal(amount), userId, currencyCode: currencyCode ?? goal.currencyCode });
    const amounts = {
      targetAmount: targetAmount === undefined ? undefined : await round({ amount: targetAmount }),
      plannedMonthly: plannedMonthly == null ? plannedMonthly : await round({ amount: plannedMonthly }),
    };

    const nextStatus = status ?? goal.status;
    const unarchiving =
      !GOAL_STATUSES_HOLDING_SHARES.includes(goal.status) && GOAL_STATUSES_HOLDING_SHARES.includes(nextStatus);

    const completionChanged =
      currencyChanged || (amounts.targetAmount !== undefined && !amounts.targetAmount.equals(goal.targetAmount));

    if (accounts !== undefined || unarchiving || completionChanged) {
      await writeGoalShares({
        userId,
        goalId,
        status: nextStatus,
        target: {
          amount: amounts.targetAmount ?? goal.targetAmount,
          currencyCode: currencyCode ?? goal.currencyCode,
        },
        shares: accounts,
      });
    }

    const logoPatch = await applyLogoWrite({
      write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage },
      stored: goal,
    });

    await goal.update({
      ...removeUndefinedKeys({
        ...fields,
        status,
        currencyCode,
        targetAmount: amounts.targetAmount,
        plannedMonthly: amounts.plannedMonthly,
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
