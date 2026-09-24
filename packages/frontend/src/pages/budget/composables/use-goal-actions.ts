import { toggleBudgetLineGoalSnooze } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { type MaybeRefOrGetter, toValue } from 'vue';

import { buildPoolAssignPayload } from '../helpers';
import { useSetAssignment } from './use-set-assignment';

export const useGoalActions = ({
  planId,
  periodId,
  line,
}: {
  planId: MaybeRefOrGetter<string>;
  periodId: MaybeRefOrGetter<string>;
  line: MaybeRefOrGetter<BudgetPlanPeriodViewLine>;
}) => {
  const { isPending: isSnoozing, mutate: snooze } = useInvalidatingMutation({
    mutationFn: toggleBudgetLineGoalSnooze,
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
    errorKey: 'budgetPlans.goals.snoozeError',
  });

  const { isPending: isBudgeting, mutate: assign } = useSetAssignment();

  const params = () => ({ planId: toValue(planId), lineId: toValue(line).lineId, periodId: toValue(periodId) });

  const toggleSnooze = () => {
    if (!isSnoozing.value) snooze(params());
  };

  /** Adds the goal's budget amount on top of this period's assigned. */
  const budgetGoal = () => {
    const current = toValue(line);
    const payload = buildPoolAssignPayload({ line: current, amount: current.goal?.budgetAmount ?? null });
    if (payload && !isBudgeting.value) assign({ ...params(), payload });
  };

  return { isSnoozing, isBudgeting, toggleSnooze, budgetGoal };
};
