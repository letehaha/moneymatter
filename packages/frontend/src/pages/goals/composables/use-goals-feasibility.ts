import { FIRE_SEED_MIN_MONTHS, getFireSeedPeriods } from '@/composable/fire/derive-fire-seed';
import { useFireSeedCashFlow } from '@/composable/fire/use-fire-seed-cash-flow';
import { captureException } from '@/lib/sentry';
import { goalMonthlyDemand, median } from '@bt/shared/goals/goal-math';
import type { CashFlowPeriodData, GoalInsights, GoalModel } from '@bt/shared/types';
import { type MaybeRefOrGetter, computed, toValue, watch } from 'vue';

import { getGoalSection } from '../helpers';

type FeasibilityGoal = GoalModel & { insights: GoalInsights };

/** `monthly` is a base-currency decimal. */
interface GoalFeasibilityItem {
  goal: GoalModel;
  monthly: number;
  fits: boolean;
}

/** Due within a month or overdue (`daysLeft` < 0): the whole remainder is due, so it stays out of the monthly sum. */
interface GoalFeasibilityDueItem {
  goal: GoalModel;
  daysLeft: number;
}

/** Amounts are base-currency decimals. */
type GoalsFeasibility =
  | { state: 'insufficient_history'; minMonths: number }
  | {
      state: 'ready';
      needed: number;
      saving: number;
      fits: boolean;
      baseCurrencyCode: string;
      items: GoalFeasibilityItem[];
      due: GoalFeasibilityDueItem[];
    };

const getFeasibilityGoals = ({ goals }: { goals: GoalModel[] }) =>
  goals.filter(
    (goal): goal is FeasibilityGoal =>
      goal.status === 'active' &&
      goal.insights !== null &&
      getGoalSection({ goal }) === 'active' &&
      (goal.targetDate !== null || goal.plannedMonthly !== null),
  );

/** Goals are funded nearest date first (undated last), so each one fits only if everything before it does too. */
export const computeGoalsFeasibility = ({
  goals,
  periods,
  now,
}: {
  goals: GoalModel[];
  periods: Pick<CashFlowPeriodData, 'periodStart' | 'income' | 'expenses' | 'netFlow'>[];
  now: Date;
}): GoalsFeasibility | null => {
  const candidates = getFeasibilityGoals({ goals });
  if (!candidates.length) return null;

  const used = getFireSeedPeriods({ periods, now });
  const saving = used.length >= FIRE_SEED_MIN_MONTHS ? median({ values: used.map((p) => p.netFlow) }) : null;
  if (saving === null) return { state: 'insufficient_history', minMonths: FIRE_SEED_MIN_MONTHS };

  const sorted = [...candidates].sort((a, b) => {
    if (a.targetDate === b.targetDate) return 0;
    if (a.targetDate === null) return 1;
    if (b.targetDate === null) return -1;
    return a.targetDate < b.targetDate ? -1 : 1;
  });

  let running = 0;
  const items: GoalFeasibilityItem[] = [];
  const due: GoalFeasibilityDueItem[] = [];
  for (const goal of sorted) {
    const monthly = goalMonthlyDemand(goal.insights);
    if (monthly === null) {
      due.push({ goal, daysLeft: goal.insights.daysLeft! });
      continue;
    }
    running += monthly;
    items.push({ goal, monthly, fits: running <= saving });
  }
  if (!items.length) return null;

  return {
    state: 'ready',
    needed: running,
    saving,
    fits: running <= saving,
    baseCurrencyCode: sorted[0]!.insights.baseCurrencyCode,
    items,
    due,
  };
};

export const useGoalsFeasibility = ({ goals }: { goals: MaybeRefOrGetter<GoalModel[]> }) => {
  const now = new Date();
  const { query } = useFireSeedCashFlow({
    now,
    enabled: () => getFeasibilityGoals({ goals: toValue(goals) }).length > 0,
  });

  watch(query.error, (error) => {
    if (error) captureException({ error, context: { scope: 'goals-feasibility:cash-flow' } });
  });

  const feasibility = computed(() =>
    query.data.value
      ? computeGoalsFeasibility({ goals: toValue(goals), periods: query.data.value.periods, now })
      : null,
  );

  return { feasibility };
};
