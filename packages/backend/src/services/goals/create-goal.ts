import type { CreateGoalPayload, GoalModel, RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Goals from '@models/goals.model';
import { applyLogoWrite } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

import { syncSavedGoal } from './check-goals-reached';
import { assertGoalCurrencyConvertible } from './goal-insights';
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
    accounts,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
  }: CreateGoalParams): Promise<RecordId> => {
    await assertGoalCurrencyConvertible({ userId, currencyCode });

    const logoPatch = await applyLogoWrite({ write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage } });

    const goal = await Goals.create({
      userId,
      name,
      currencyCode,
      targetAmount: Money.fromDecimal(targetAmount),
      targetDate,
      plannedMonthly: plannedMonthly === null ? null : Money.fromDecimal(plannedMonthly),
      ...(sortOrder !== undefined && { sortOrder }),
      ...logoPatch,
    });

    await writeGoalShares({ userId, goalId: goal.id, status: goal.status, shares: accounts });

    return goal.id;
  },
);

/** The response is read after commit, so a rate gap in the insights can't roll back the write. */
export const createGoal = async (params: CreateGoalParams): Promise<GoalModel> =>
  syncSavedGoal({ userId: params.userId, goalId: await createGoalImpl(params) });
