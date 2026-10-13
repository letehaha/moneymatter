import { BudgetLineGoal, BudgetLineGoalStatus } from '@bt/shared/types';

import { countPeriodsBetween, nextBoundary, type PeriodCadenceConfig } from '../periods/period-enumerator';
import { biweeklyDates, dueCycle, weeklyDates } from './goal-schedule';

export interface GoalAskLine {
  carriedIn: number;
  assigned: number;
  activity: number;
  available: number;
}

interface GoalAskResult {
  ask: number;
  target: number;
  progress: number;
  status: BudgetLineGoalStatus;
  /** What one period of this goal calls for; 0 for an open-ended balance. */
  periodTarget: number;
}

const ceilDiv = ({ value, by }: { value: number; by: number }): number => Math.ceil(value / by);

/** Money in integer cents, dates `yyyy-MM-dd`. */
export type GoalSpec = Omit<BudgetLineGoal, 'lineId'>;

/** One entry per plan period with this line's assigned; entries outside the active cycle are ignored. */
export interface GoalPeriodAssigned {
  start: string;
  assigned: number;
}

export interface GoalFundingPlanRow {
  periodStart: string;
  amount: number;
  leftAfter: number;
}

export interface GoalEvaluation extends GoalAskResult {
  /**
   * What "Budget $X" assigns. Asks measured from `available` already include an overspend;
   * the others add it. Open-ended funds the whole gap.
   */
  budgetAmount: number;
  /** Due date of the active cycle (yearly, by date). */
  dueDate: string | null;
  /** Weekly / biweekly occurrence dates inside the period. */
  occurrences: string[] | null;
  fundedThrough: string | null;
  nextNeededDate: string | null;
  fundingPlan: GoalFundingPlanRow[] | null;
}

const repeatMonths = ({ goal }: { goal: GoalSpec }): number | null => {
  if (goal.frequency === 'yearly') return 12;
  if (!goal.repeatEvery || !goal.repeatUnit) return null;
  return goal.repeatUnit === 'years' ? goal.repeatEvery * 12 : goal.repeatEvery;
};

/**
 * The first row is this period's ask; the rest split what is left after it evenly, the last row taking the remainder.
 * Rows stop once they have put `room` into the line.
 */
const buildFundingPlan = ({
  plan,
  periodStart,
  periodsLeft,
  ask,
  remaining,
  room,
}: {
  plan: PeriodCadenceConfig;
  periodStart: string;
  periodsLeft: number;
  ask: number;
  remaining: number;
  room: number;
}): GoalFundingPlanRow[] => {
  const rows: GoalFundingPlanRow[] = [{ periodStart, amount: ask, leftAfter: remaining }];
  const share = periodsLeft > 1 ? ceilDiv({ value: remaining, by: periodsLeft - 1 }) : 0;
  let left = remaining;
  let roomLeft = room;
  let start = periodStart;
  for (let index = 1; index < periodsLeft && roomLeft > 0; index += 1) {
    start = nextBoundary({ plan, after: start });
    const amount = Math.min(index === periodsLeft - 1 ? left : Math.min(share, left), roomLeft);
    left -= amount;
    roomLeft -= amount;
    rows.push({ periodStart: start, amount, leftAfter: left });
  }
  return rows;
};

/**
 * Pure, integer cents. `period.end` is exclusive. `history` feeds the cycle sum of
 * yearly / by-date budget-another goals and may hold any range of periods.
 */
export const evaluateGoal = ({
  goal,
  line,
  period,
  history,
  plan,
}: {
  goal: GoalSpec;
  line: GoalAskLine;
  period: { start: string; end: string };
  history: GoalPeriodAssigned[];
  plan: PeriodCadenceConfig;
}): GoalEvaluation => {
  const { amount, behavior, frequency } = goal;
  const balance = line.carriedIn + line.assigned;
  let target = amount;
  let periodTarget = amount;
  let progress = line.available;
  let ask = 0;
  let occurrences: string[] | null = null;
  let cycle: { dueDate: string; periodsLeft: number; need: number } | null = null;

  if (frequency === 'open_ended') {
    periodTarget = 0;
  } else if (frequency === 'yearly' || frequency === 'by_date') {
    const { dueDate, previousDueDate } = dueCycle({
      anchorDate: goal.anchorDate!,
      everyMonths: repeatMonths({ goal }),
      from: period.start,
    });
    const periodsLeft = Math.max(1, countPeriodsBetween({ plan, from: period.start, to: dueDate }) + 1);

    let need: number;
    if (behavior === 'budget_another') {
      const afterPrevious = previousDueDate ? nextBoundary({ plan, after: previousDueDate }) : goal.startPeriodStart;
      const cycleStart = afterPrevious > goal.startPeriodStart ? afterPrevious : goal.startPeriodStart;
      const earlier = history
        .filter((entry) => entry.start >= cycleStart && entry.start < period.start)
        .reduce((sum, entry) => sum + entry.assigned, 0);
      need = amount - earlier;
      progress = earlier + line.assigned;
    } else {
      need = amount - (line.available - line.assigned);
    }

    periodTarget = ceilDiv({ value: Math.max(0, need), by: periodsLeft });
    ask = Math.max(0, periodTarget - line.assigned);
    cycle = { dueDate, periodsLeft, need };
  } else {
    if (frequency === 'weekly') {
      occurrences = weeklyDates({ start: period.start, end: period.end, weekday: goal.weekday! });
    } else if (frequency === 'biweekly') {
      occurrences = biweeklyDates({ start: period.start, end: period.end, anchorDate: goal.anchorDate! });
    }
    if (occurrences) periodTarget = amount * occurrences.length;
    target = periodTarget;
    progress = behavior === 'budget_another' ? line.assigned : balance;
    ask = Math.max(0, periodTarget - progress);
  }

  const cap = behavior === 'budget_another' ? goal.stopAtBalance : null;
  if (cap !== null) ask = Math.max(0, Math.min(ask, cap - balance));
  if (behavior === 'refill_up_to' && goal.fundingCap !== null) ask = Math.min(ask, goal.fundingCap);

  let status: BudgetLineGoalStatus;
  if (frequency !== 'open_ended' && goal.snoozedPeriodStart === period.start) {
    status = 'snoozed';
    ask = 0;
  } else if (behavior === 'reach_balance' && line.available >= amount) status = 'achieved';
  else if (ask === 0) status = 'funded';
  else status = 'underfunded';

  let fundedThrough: string | null = null;
  let nextNeededDate: string | null = null;
  if (occurrences) {
    const covered =
      amount > 0 ? Math.min(occurrences.length, Math.floor(Math.max(0, progress) / amount)) : occurrences.length;
    fundedThrough = occurrences[covered - 1] ?? null;
    nextNeededDate = occurrences[covered] ?? null;
  }

  let fundingPlan: GoalFundingPlanRow[] | null = null;
  if (cycle && status !== 'snoozed' && status !== 'achieved') {
    const remaining = Math.max(0, cycle.need - line.assigned - ask);
    const room = cap === null ? Infinity : Math.max(0, cap - balance - ask);
    if (ask + Math.min(remaining, room) > 0) {
      fundingPlan = buildFundingPlan({
        plan,
        periodStart: period.start,
        periodsLeft: cycle.periodsLeft,
        ask,
        remaining,
        room,
      });
    }
  }

  let budgetAmount = ask;
  if (frequency === 'open_ended') budgetAmount = Math.max(0, amount - line.available);
  else if (!cycle || behavior === 'budget_another') budgetAmount += Math.max(0, -line.available);

  return {
    ask,
    target,
    progress,
    status,
    periodTarget,
    budgetAmount,
    dueDate: cycle?.dueDate ?? null,
    occurrences,
    fundedThrough,
    nextNeededDate,
    fundingPlan,
  };
};
