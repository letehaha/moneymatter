import type { CreateGoalPayload, GoalModel, RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Goals from '@models/goals.model';
import { applyLogoWrite } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

import { syncSavedGoal } from './check-goals-reached';
import { assertGoalCurrencyConvertible } from './goal-insights';
import { roundGoalAmount } from './round-goal-amount';
import { writeGoalShares } from './share-capacity';

type CreateGoalParams = CreateGoalPayload & { userId: number };

const createGoalImpl = withTransaction(
  async ({
    userId,
    name,
    currencyCode,
    targetAmount,
    targetDate = null,
    plannedMonthly = null,
    sortOrder,
    reachedHoldDays,
    accounts,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
  }: CreateGoalParams): Promise<RecordId> => {
    await assertGoalCurrencyConvertible({ userId, currencyCode });

    const logoPatch = await applyLogoWrite({ write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage } });
    const round = ({ amount }: { amount: number }) =>
      roundGoalAmount({ money: Money.fromDecimal(amount), userId, currencyCode });
    const amounts = {
      targetAmount: await round({ amount: targetAmount }),
      plannedMonthly: plannedMonthly === null ? null : await round({ amount: plannedMonthly }),
    };

    const goal = await Goals.create({
      userId,
      name,
      currencyCode,
      targetAmount: amounts.targetAmount,
      targetDate,
      plannedMonthly: amounts.plannedMonthly,
      ...(sortOrder !== undefined && { sortOrder }),
      ...(reachedHoldDays !== undefined && { reachedHoldDays }),
      ...logoPatch,
    });

    await writeGoalShares({
      userId,
      goalId: goal.id,
      status: goal.status,
      target: { amount: goal.targetAmount, currencyCode },
      shares: accounts,
    });

    return goal.id;
  },
);

/** The response is read after commit, so a rate gap in the insights can't roll back the write. */
export const createGoal = async (params: CreateGoalParams): Promise<GoalModel> =>
  syncSavedGoal({ userId: params.userId, goalId: await createGoalImpl(params) });
