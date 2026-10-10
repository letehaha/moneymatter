import { cn } from '@/lib/utils';
import {
  type AccountModel,
  BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES,
  BUDGET_PLAN_CARRY_POLICIES,
  type BudgetAssignmentScope,
  type BudgetLineGoalBehavior,
  type BudgetLineGoalFrequency,
  type BudgetLineGoalRepeatUnit,
  type BudgetPlanCadence,
  type BudgetPlanCarryPolicy,
  type BudgetPlanLineEntry,
  type BudgetPlanPeriod,
  type BudgetPlanPeriodView,
  type BudgetPlanPeriodViewLine,
  type BudgetPlanPeriodViewLineGoal,
  type BudgetPlanScheduled,
  type BudgetPlanTrendPeriod,
  type BudgetPlanTrends,
  type BudgetPlanTypeKey,
  type CreateBudgetPlanPayload,
  type SetBudgetLineGoalPayload,
  type SetBudgetPlanAssignmentPayload,
  type SetBudgetPlanLayoutPayload,
} from '@bt/shared/types';
import {
  type Locale,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  getDate,
  isSameMonth,
  isSameYear,
  isValid,
  parseISO,
  subDays,
} from 'date-fns';

export const BUDGET_CADENCE_PRESETS = ['monthly', 'semiMonthly', 'biweekly', 'weekly'] as const;
export type BudgetCadencePreset = (typeof BUDGET_CADENCE_PRESETS)[number];

const BIWEEKLY_INTERVAL_DAYS = 14;
const WEEKLY_INTERVAL_DAYS = 7;
const HALF_MONTH_DAYS = 15;

/** `endDate` is exclusive, so the label ends on the day before it. */
export const formatPeriodLabel = ({
  startDate,
  endDate,
  locale,
}: {
  startDate: string;
  endDate: string;
  locale?: Locale;
}): string => {
  const start = parseISO(startDate);
  const last = subDays(parseISO(endDate), 1);
  const fmt = ({ date, pattern }: { date: Date; pattern: string }) => format(date, pattern, { locale });
  const end = fmt({ date: last, pattern: 'd MMM yyyy' });

  if (isSameMonth(start, last)) return `${fmt({ date: start, pattern: 'd' })} – ${end}`;
  if (isSameYear(start, last)) return `${fmt({ date: start, pattern: 'd MMM' })} – ${end}`;
  return `${fmt({ date: start, pattern: 'd MMM yyyy' })} – ${end}`;
};

export const buildCreatePlanPayload = ({
  name,
  preset,
  startsOn,
  accountIds,
  carryPolicy,
  withSuggestedLines,
}: {
  name: string;
  preset: BudgetCadencePreset;
  startsOn: Date;
  accountIds: string[];
  carryPolicy: BudgetPlanCarryPolicy;
  withSuggestedLines: boolean;
}): CreateBudgetPlanPayload => {
  const type: BudgetPlanTypeKey = 'category_caps';
  const anchorDate = format(startsOn, 'yyyy-MM-dd');
  // Today is never sent: a client ahead of UTC would trip the backend's epoch-in-future check.
  const isBackdated = anchorDate < format(new Date(), 'yyyy-MM-dd');
  const base = {
    name,
    type,
    accountIds,
    carryPolicy,
    withSuggestedLines,
    ...(isBackdated && { epochDate: anchorDate }),
  };
  const day = getDate(startsOn);

  switch (preset) {
    case 'monthly':
      return { ...base, cadence: 'months', intervalN: 1, anchorDate };
    case 'semiMonthly':
      return {
        ...base,
        cadence: 'semi_monthly',
        anchorDate,
        secondAnchorDay: day < HALF_MONTH_DAYS ? day + HALF_MONTH_DAYS : day - (HALF_MONTH_DAYS - 1),
      };
    case 'biweekly':
      return {
        ...base,
        cadence: 'days',
        intervalN: BIWEEKLY_INTERVAL_DAYS,
        anchorDate,
      };
    case 'weekly':
      return {
        ...base,
        cadence: 'days',
        intervalN: WEEKLY_INTERVAL_DAYS,
        anchorDate,
      };
  }
};

export const CARRY_POLICY_OPTIONS = BUDGET_PLAN_CARRY_POLICIES.map((value) => ({
  value,
  labelKey: `budgetPlans.carryPolicy.${value}`,
}));

export const buildCarryOptions = ({ t }: { t: (key: string) => string }) =>
  CARRY_POLICY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));

export const isAttachableAccount = (account: AccountModel) =>
  BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES.includes(account.accountCategory) &&
  (!account.share || account.share.isOwner);

/** Pool / zero-sum UI is held back from the first release; flip to re-expose the plan switches. */
export const BUDGET_POOL_ENABLED = false;

export const cadenceLabel = ({
  cadence,
  intervalN,
}: {
  cadence: BudgetPlanCadence;
  intervalN: number;
}): { key: string; params: { n: number } } => {
  const params = { n: intervalN };
  if (cadence === 'semi_monthly') return { key: 'budgetPlans.cadence.semiMonthly', params };
  if (cadence === 'months') {
    return intervalN === 1
      ? { key: 'budgetPlans.cadence.monthly', params }
      : { key: 'budgetPlans.cadence.everyNMonths', params };
  }
  if (intervalN === WEEKLY_INTERVAL_DAYS) return { key: 'budgetPlans.cadence.weekly', params };
  if (intervalN === BIWEEKLY_INTERVAL_DAYS) return { key: 'budgetPlans.cadence.biweekly', params };
  return { key: 'budgetPlans.cadence.everyNDays', params };
};

/** `total` is negative (or 0) — the sum of the lines that went past their cap. */
export const sumOverspent = ({ lines }: { lines: { available: number }[] }): { total: number; lineCount: number } => {
  const overspent = lines.filter((line) => line.available < 0);
  return {
    total: overspent.reduce((sum, line) => sum + line.available, 0),
    lineCount: overspent.length,
  };
};

/** The four period figures shown in the summary strip and the mobile overview. */
export const headerStats = ({ view }: { view: Pick<BudgetPlanPeriodView, 'header' | 'lines'> }) => {
  const overspent = sumOverspent({ lines: view.lines });
  return {
    overspentLineCount: overspent.lineCount,
    stats: [
      {
        key: 'assigned',
        labelKey: 'budgetPlans.tiles.assigned',
        amount: view.header.totalAssigned,
        toned: false,
      },
      {
        key: 'spent',
        labelKey: 'budgetPlans.tiles.spent',
        amount: -view.header.totalActivity,
        toned: false,
      },
      {
        key: 'available',
        labelKey: 'budgetPlans.tiles.available',
        amount: view.header.totalAvailable,
        toned: true,
      },
      {
        key: 'overspent',
        labelKey: 'budgetPlans.tiles.overspent',
        amount: overspent.total,
        toned: true,
      },
    ],
  };
};

export const amountToneClass = ({ amount }: { amount: number }): string =>
  cn(
    amount > 0 && 'text-app-income-color',
    amount < 0 && 'text-app-expense-color',
    amount === 0 && 'text-muted-foreground',
  );

export const defaultAssignmentScope = ({
  line,
}: {
  line: Pick<BudgetPlanPeriodViewLine, 'assignedSource'>;
}): BudgetAssignmentScope => (line.assignedSource === 'override' ? 'this_period' : 'from_here');

/** `null` when nothing would change. */
export const buildAssignmentPayload = ({
  line,
  amount,
  scope,
  carryPolicy,
}: {
  line: Pick<BudgetPlanPeriodViewLine, 'assigned' | 'assignedSource' | 'carryPolicy'>;
  amount: number | null;
  scope: BudgetAssignmentScope;
  carryPolicy: BudgetPlanCarryPolicy;
}): SetBudgetPlanAssignmentPayload | null => {
  // null would clear the column rather than assign 0.
  const nextAmount = amount ?? 0;
  // Sending the amount with from_here rewrites the baseline, so an unchanged amount goes out only to promote an override.
  const sendAmount = nextAmount !== line.assigned || (line.assignedSource === 'override' && scope === 'from_here');
  const carryChanged = carryPolicy !== line.carryPolicy;
  if (!sendAmount && !carryChanged) return null;
  return {
    scope,
    ...(sendAmount && { amount: nextAmount }),
    ...(carryChanged && { carryPolicy }),
  };
};

/** Adds `amount` on top of the line's assigned for this period only; `null` for a non-positive amount. */
export const buildPoolAssignPayload = ({
  line,
  amount,
}: {
  line: Pick<BudgetPlanPeriodViewLine, 'assigned' | 'assignedSource' | 'carryPolicy'>;
  amount: number | null;
}): SetBudgetPlanAssignmentPayload | null => {
  if (!amount || amount <= 0) return null;
  return buildAssignmentPayload({
    line,
    amount: Math.round((line.assigned + amount) * 100) / 100,
    scope: 'this_period',
    carryPolicy: line.carryPolicy,
  });
};

/** Takes `amount` off the line's assigned for this period only; `null` unless 0 < amount <= poolAssigned. */
export const buildPoolTakeBackPayload = ({
  line,
  amount,
}: {
  line: Pick<BudgetPlanPeriodViewLine, 'assigned' | 'poolAssigned' | 'assignedSource' | 'carryPolicy'>;
  amount: number | null;
}): SetBudgetPlanAssignmentPayload | null => {
  if (!amount || amount <= 0 || amount > line.poolAssigned) return null;
  return buildAssignmentPayload({
    line,
    amount: Math.round((line.assigned - amount) * 100) / 100,
    scope: 'this_period',
    carryPolicy: line.carryPolicy,
  });
};

/** Lines holding money Ready to Assign counts, so taking it back raises Ready to Assign by the amount. */
export const takeBackCandidates = <T extends Pick<BudgetPlanPeriodViewLine, 'poolAssigned'>>({
  lines,
}: {
  lines: T[];
}): T[] => lines.filter((line) => line.poolAssigned > 0);

const takeBackRoom = ({ line }: { line: Pick<BudgetPlanPeriodViewLine, 'available' | 'poolAssigned'> }) =>
  Math.min(line.poolAssigned, Math.max(line.available, 0));

/** The line that can give back the most without going overspent, the first one on a tie. */
export const pickTakeBackLine = <T extends Pick<BudgetPlanPeriodViewLine, 'available' | 'poolAssigned'>>({
  lines,
}: {
  lines: T[];
}): T | undefined =>
  lines.reduce<T | undefined>(
    (best, line) => (best && takeBackRoom({ line: best }) >= takeBackRoom({ line }) ? best : line),
    undefined,
  );

export const spentOf = ({ line }: { line: Pick<BudgetPlanPeriodViewLine, 'activity'> }) => Math.max(0, -line.activity);

const clampedPercent = ({ part, whole }: { part: number; whole: number }) => {
  if (whole <= 0) return part > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
};

/** Percents are of the funded amount. A negative carry-in funds nothing, so it counts as 0. */
export const lineBarsOf = ({
  line,
}: {
  line: Pick<BudgetPlanPeriodViewLine, 'carriedIn' | 'assigned' | 'activity' | 'available'>;
}) => {
  const carried = Math.max(0, line.carriedIn);
  const assigned = Math.max(0, line.assigned);
  const spent = spentOf({ line });
  return {
    carried,
    assigned,
    spentPercent: clampedPercent({ part: spent, whole: carried + assigned }),
    carriedSpentPercent: clampedPercent({
      part: Math.min(spent, carried),
      whole: carried,
    }),
    assignedSpentPercent: clampedPercent({
      part: spent - carried,
      whole: assigned,
    }),
    isOverspent: line.available < 0,
  };
};

/** Lines that started before the current period. Without a current period every line counts, so delete keeps its warning. */
export const lineIdsWithHistory = ({
  lines,
  periods,
}: {
  lines: Pick<BudgetPlanLineEntry, 'id' | 'activeFrom'>[];
  periods: Pick<BudgetPlanPeriod, 'startDate' | 'isCurrent'>[];
}): Set<string> => {
  const currentStart = periods.find((period) => period.isCurrent)?.startDate;
  return new Set(lines.filter((line) => !currentStart || line.activeFrom < currentStart).map((line) => line.id));
};

/** Today counts as elapsed. Spent is measured against carried-in plus assigned money. */
export const spendingPace = ({
  activity,
  carriedIn,
  assigned,
  startDate,
  endDate,
  now = new Date(),
}: {
  activity: number;
  carriedIn: number;
  assigned: number;
  startDate: string;
  endDate: string;
  now?: Date;
}) => {
  const spent = Math.max(0, -activity);
  const total = carriedIn + assigned;
  const spentPercent = total > 0 ? (spent / total) * 100 : spent > 0 ? 100 : 0;
  const { day, totalDays, daysLeft } = periodProgress({
    startDate,
    endDate,
    now,
  });

  return {
    spent,
    total,
    spentPercent,
    elapsedPercent: totalDays > 0 ? (day / totalDays) * 100 : 0,
    daysLeft,
  };
};

/** `day` counts today as elapsed and is clamped to the period, so it reads as "Day 12 of 30". */
export const periodProgress = ({
  startDate,
  endDate,
  now = new Date(),
}: {
  startDate: string;
  endDate: string;
  now?: Date;
}) => {
  const totalDays = differenceInCalendarDays(parseISO(endDate), parseISO(startDate));
  const day = Math.min(totalDays, Math.max(0, differenceInCalendarDays(now, parseISO(startDate)) + 1));
  return { day, totalDays, daysLeft: totalDays - day };
};

export interface PanelContext {
  planId: string;
  cadence: BudgetPlanCadence;
  unit: GoalPeriodUnit;
  period: BudgetPlanPeriod;
  /** Empty for the whole-period overview; several ids aggregate the selection. */
  lineIds: string[];
  figures: Pick<BudgetPlanPeriodViewLine, 'carriedIn' | 'assigned' | 'activity' | 'available'>;
  trends?: BudgetPlanTrends;
  /** Already narrowed to `lineIds`. */
  scheduled?: BudgetPlanScheduled;
}

export type TrendKind = 'budgeting' | 'spending';

const TREND_AVERAGE_WINDOW = 5;
const TREND_SLOT_COUNT = 6;

/**
 * Start dates for the empty slots left of `oldest`, oldest first, so the chart always has `slotCount` columns.
 * Extrapolated from the oldest period's length; `null` for semi-monthly, whose halves differ in length.
 */
export const trendPaddingStarts = ({
  oldest,
  cadence,
  periodCount,
  slotCount = TREND_SLOT_COUNT,
}: {
  oldest: Pick<BudgetPlanTrendPeriod, 'startDate' | 'endDate'> | undefined;
  cadence: BudgetPlanCadence;
  periodCount: number;
  slotCount?: number;
}): (string | null)[] => {
  const padCount = Math.max(0, slotCount - periodCount);
  const offsets = Array.from({ length: padCount }, (_, index) => padCount - index);
  if (!oldest || cadence === 'semi_monthly') return offsets.map(() => null);

  const start = parseISO(oldest.startDate);
  const end = parseISO(oldest.endDate);
  return offsets.map((offset) => {
    const date =
      cadence === 'months'
        ? addMonths(start, -offset * differenceInCalendarMonths(end, start))
        : subDays(start, offset * differenceInCalendarDays(end, start));
    return format(date, 'yyyy-MM-dd');
  });
};

/** A line missing from a period (not active yet) counts as 0. */
export const trendValues = ({
  periods,
  lineIds,
  kind,
}: {
  periods: BudgetPlanTrendPeriod[];
  lineIds: string[];
  kind: TrendKind;
}): number[] => {
  const ids = new Set(lineIds);
  const valueOf = (source: { assigned: number; activity: number }) =>
    kind === 'budgeting' ? source.assigned : Math.max(0, -source.activity);
  return periods.map((period) =>
    ids.size
      ? period.lines.filter((line) => ids.has(line.lineId)).reduce((sum, line) => sum + valueOf(line), 0)
      : valueOf(period),
  );
};

/** The last value is the current period. `changePercent` is `null` when the previous value is 0 or missing. */
export const trendSummary = ({ values }: { values: number[] }) => {
  const current = values.at(-1) ?? 0;
  const previous = values.at(-2);
  const earlier = values.slice(0, -1).slice(-TREND_AVERAGE_WINDOW);
  const max = Math.max(0, ...values);

  return {
    current,
    heights: values.map((value) => (max > 0 ? (Math.max(0, value) / max) * 100 : 0)),
    changePercent: previous ? ((current - previous) / Math.abs(previous)) * 100 : null,
    average: earlier.length ? earlier.reduce((sum, value) => sum + value, 0) / earlier.length : null,
    averageCount: earlier.length,
  };
};

export const isPastPeriod = ({ period, now = new Date() }: { period: Pick<BudgetPlanPeriod, 'endDate'>; now?: Date }) =>
  period.endDate <= format(now, 'yyyy-MM-dd');

export const scheduledForLines = ({
  scheduled,
  lineIds,
}: {
  scheduled: BudgetPlanScheduled;
  lineIds: string[];
}): BudgetPlanScheduled => {
  if (!lineIds.length) return scheduled;
  const ids = new Set(lineIds);
  const items = scheduled.items.filter((item) => item.lineId !== null && ids.has(item.lineId));
  const sum = ({ outflow }: { outflow: boolean }) => {
    const matching = items.filter((item) => (outflow ? item.amount < 0 : item.amount >= 0));
    return {
      total: matching.reduce((total, item) => total + item.amount, 0),
      count: matching.length,
    };
  };
  return {
    items,
    outflows: sum({ outflow: true }),
    inflows: sum({ outflow: false }),
    nextDate: items[0]?.date ?? null,
  };
};

type GoalDisplayKind = 'underfunded' | 'funded' | 'achieved' | 'snoozed' | 'progress';

const GOAL_DISPLAY_TONES: Record<GoalDisplayKind, { textClass: string; barClass: string }> = {
  underfunded: { textClass: 'text-warning-text', barClass: 'bg-warning' },
  funded: { textClass: 'text-success-text', barClass: 'bg-success-text' },
  achieved: { textClass: 'text-success-text', barClass: 'bg-success-text' },
  progress: { textClass: 'text-primary-text', barClass: 'bg-primary' },
  snoozed: {
    textClass: 'text-muted-foreground',
    barClass: 'bg-muted-foreground/40',
  },
};

/** An open-ended goal never asks, so instead of "funded" it shows how far along it is. */
export const goalStatusDisplay = ({
  goal,
}: {
  goal: Pick<BudgetPlanPeriodViewLineGoal, 'frequency' | 'status' | 'progress' | 'target'>;
}) => {
  const kind: GoalDisplayKind = goal.status === 'funded' && goal.frequency === 'open_ended' ? 'progress' : goal.status;
  const ratio = goal.target > 0 ? goal.progress / goal.target : 0;
  const percent = kind === 'achieved' ? 100 : Math.min(100, Math.max(0, Math.floor(ratio * 100)));
  return { kind, percent, ...GOAL_DISPLAY_TONES[kind] };
};

/** The word goal copy uses for one plan period: only a one-month plan says "month". */
export type GoalPeriodUnit = 'month' | 'period';

export const goalPeriodUnit = ({
  cadence,
  intervalN,
}: {
  cadence: BudgetPlanCadence;
  intervalN: number;
}): GoalPeriodUnit => (cadence === 'months' && intervalN === 1 ? 'month' : 'period');

export type GoalTextParam =
  | { money: number }
  | { date: string; pattern: string }
  | { weekday: number }
  | { part: GoalTextPart }
  | { value: number | string };

/** An i18n key plus raw params; `useGoalText` formats and translates it. */
export interface GoalTextPart {
  key: string;
  params?: Record<string, GoalTextParam>;
}

const GOAL_FULL_DATE_PATTERN = 'P';
const GOAL_DAY_MONTH_PATTERN = 'd MMM';
const GOAL_ORDINAL_DAY_PATTERN = 'do';

export const goalTitle = ({
  goal,
}: {
  goal: Pick<BudgetPlanPeriodViewLineGoal, 'behavior' | 'amount'>;
}): GoalTextPart => ({
  key: `budgetPlans.goals.title.${goal.behavior}`,
  params: { amount: { money: goal.amount } },
});

export const goalSubtitle = ({
  goal,
  unit,
}: {
  goal: Pick<BudgetPlanPeriodViewLineGoal, 'frequency' | 'weekday' | 'anchorDate' | 'dueDate'>;
  unit: GoalPeriodUnit;
}): GoalTextPart => {
  const date = goal.dueDate ?? goal.anchorDate ?? '';
  switch (goal.frequency) {
    case 'every_period':
      return { key: `budgetPlans.goals.unit.${unit}.frequency` };
    case 'weekly':
      return {
        key: 'budgetPlans.goals.subtitle.weeklyOn',
        params: { weekday: { weekday: goal.weekday ?? 0 } },
      };
    case 'biweekly':
      return { key: 'budgetPlans.goals.subtitle.biweekly' };
    case 'yearly':
      return {
        key: 'budgetPlans.goals.subtitle.yearlyDue',
        params: { date: { date, pattern: GOAL_DAY_MONTH_PATTERN } },
      };
    case 'by_date':
      return {
        key: 'budgetPlans.goals.dueBy',
        params: { date: { date, pattern: GOAL_FULL_DATE_PATTERN } },
      };
    case 'open_ended':
      return { key: 'budgetPlans.goals.subtitle.noDeadline' };
  }
};

/** The status text on a grid row. */
export const goalCaption = ({
  goal,
  unit,
}: {
  goal: Pick<
    BudgetPlanPeriodViewLineGoal,
    'frequency' | 'status' | 'ask' | 'progress' | 'target' | 'fundedThrough' | 'nextNeededDate'
  >;
  unit: GoalPeriodUnit;
}): { part: GoalTextPart; icon: 'check' | 'moon' | null } => {
  const display = goalStatusDisplay({ goal });
  if (display.kind === 'snoozed') return { part: { key: 'budgetPlans.goals.status.snoozed' }, icon: 'moon' };
  if (display.kind === 'achieved')
    return {
      part: { key: 'budgetPlans.goals.status.achieved' },
      icon: 'check',
    };
  if (display.kind === 'funded') return { part: { key: 'budgetPlans.goals.status.funded' }, icon: 'check' };
  if (display.kind === 'progress') {
    return {
      part: {
        key: 'budgetPlans.goals.progressFraction',
        params: {
          progress: { money: goal.progress },
          target: { money: goal.target },
          percent: { value: display.percent },
        },
      },
      icon: null,
    };
  }

  const isWeekly = goal.frequency === 'weekly' || goal.frequency === 'biweekly';
  if (isWeekly && goal.fundedThrough) {
    return {
      part: {
        key: 'budgetPlans.goals.fundedThrough',
        params: {
          date: { date: goal.fundedThrough, pattern: GOAL_ORDINAL_DAY_PATTERN },
        },
      },
      icon: null,
    };
  }
  if (isWeekly && goal.nextNeededDate) {
    return {
      part: {
        key: 'budgetPlans.goals.needBy',
        params: {
          amount: { money: goal.ask },
          date: {
            date: goal.nextNeededDate,
            pattern: GOAL_ORDINAL_DAY_PATTERN,
          },
        },
      },
      icon: null,
    };
  }
  return {
    part: {
      key: `budgetPlans.goals.unit.${unit}.need`,
      params: { amount: { money: goal.ask } },
    },
    icon: null,
  };
};

/** The goal peek's figures, by behaviour. */
export const goalPeekStats = ({
  goal,
  line,
  unit,
}: {
  goal: Pick<BudgetPlanPeriodViewLineGoal, 'behavior' | 'progress' | 'target' | 'periodTarget' | 'ask'>;
  line: Pick<BudgetPlanPeriodViewLine, 'assigned'>;
  unit: GoalPeriodUnit;
}): { labelKey: string; amount: number }[] => {
  const need = {
    labelKey: `budgetPlans.goals.unit.${unit}.needLabel`,
    amount: goal.ask,
  };
  if (goal.behavior === 'reach_balance') {
    return [
      { labelKey: 'budgetPlans.goals.stats.saved', amount: goal.progress },
      { labelKey: 'budgetPlans.goals.stats.target', amount: goal.target },
      {
        labelKey: 'budgetPlans.goals.stats.leftToSave',
        amount: Math.max(0, goal.target - goal.progress),
      },
      need,
    ];
  }
  if (goal.behavior === 'refill_up_to') {
    return [
      { labelKey: 'budgetPlans.goals.stats.balance', amount: goal.progress },
      { labelKey: 'budgetPlans.goals.stats.refillTo', amount: goal.target },
      need,
    ];
  }
  return [
    {
      labelKey: `budgetPlans.goals.unit.${unit}.budgeted`,
      amount: line.assigned,
    },
    {
      labelKey: `budgetPlans.goals.unit.${unit}.target`,
      amount: goal.periodTarget,
    },
    need,
  ];
};

export const GOAL_EDITOR_FREQUENCIES = [
  'weekly',
  'biweekly',
  'every_period',
  'yearly',
  'by_date',
  'open_ended',
] as const satisfies readonly BudgetLineGoalFrequency[];

const GOAL_ANCHORED_FREQUENCIES: readonly BudgetLineGoalFrequency[] = ['biweekly', 'yearly', 'by_date'];
export const GOAL_REPEAT_MAX: Record<BudgetLineGoalRepeatUnit, number> = {
  months: 11,
  years: 5,
};
const MONDAY = 1;

const defaultGoalBehavior = ({ frequency }: { frequency: BudgetLineGoalFrequency }): BudgetLineGoalBehavior =>
  frequency === 'by_date' || frequency === 'open_ended' ? 'reach_balance' : 'budget_another';

export interface GoalEditorState {
  frequency: BudgetLineGoalFrequency;
  behavior: BudgetLineGoalBehavior;
  amount: number | null;
  weekday: number;
  anchorDate: Date | null;
  repeats: boolean;
  repeatEvery: number | null;
  repeatUnit: BudgetLineGoalRepeatUnit;
  hasStopAtBalance: boolean;
  stopAtBalance: number | null;
  hasFundingCap: boolean;
  fundingCap: number | null;
}

export const goalEditorStateFrom = ({
  goal,
}: {
  goal: Pick<
    BudgetPlanPeriodViewLineGoal,
    | 'frequency'
    | 'behavior'
    | 'amount'
    | 'weekday'
    | 'anchorDate'
    | 'repeatEvery'
    | 'repeatUnit'
    | 'stopAtBalance'
    | 'fundingCap'
  > | null;
}): GoalEditorState => ({
  frequency: goal?.frequency ?? 'every_period',
  behavior: goal?.behavior ?? 'budget_another',
  amount: goal?.amount ?? null,
  weekday: goal?.weekday ?? MONDAY,
  anchorDate: goal?.anchorDate ? parseISO(goal.anchorDate) : null,
  repeats: Boolean(goal?.repeatEvery),
  repeatEvery: goal?.repeatEvery ?? 1,
  repeatUnit: goal?.repeatUnit ?? 'months',
  hasStopAtBalance: goal?.stopAtBalance != null,
  stopAtBalance: goal?.stopAtBalance ?? null,
  hasFundingCap: goal?.fundingCap != null,
  fundingCap: goal?.fundingCap ?? null,
});

/** Resets the behaviour to the frequency's default and keeps everything else, the amount included. */
export const setGoalFrequency = ({
  state,
  frequency,
}: {
  state: GoalEditorState;
  frequency: BudgetLineGoalFrequency;
}): GoalEditorState => ({
  ...state,
  frequency,
  behavior: defaultGoalBehavior({ frequency }),
});

/** Which optional fields the current frequency and behaviour use. */
export const goalEditorFields = ({ state }: { state: Pick<GoalEditorState, 'frequency' | 'behavior'> }) => {
  const { frequency, behavior } = state;
  return {
    weekday: frequency === 'weekly',
    anchorDate: GOAL_ANCHORED_FREQUENCIES.includes(frequency),
    repeat: frequency === 'by_date' && behavior !== 'reach_balance',
    stopAtBalance: behavior === 'budget_another',
    fundingCap: behavior === 'refill_up_to',
  };
};

interface GoalEditorErrors {
  amount: string | null;
  anchorDate: string | null;
  repeatEvery: string | null;
  stopAtBalance: string | null;
  fundingCap: string | null;
}

const isPositive = ({ value }: { value: number | null }) => value !== null && value > 0;

/** The backend compares due dates to the UTC calendar day. */
const toUtcDay = ({ now }: { now: Date }) => now.toISOString().slice(0, 10);

/** Mirrors the backend's 422 rules; values are i18n keys. */
export const validateGoalEditor = ({
  state,
  now = new Date(),
}: {
  state: GoalEditorState;
  now?: Date;
}): GoalEditorErrors => {
  const fields = goalEditorFields({ state });
  const amountError = 'budgetPlans.goals.errors.amount';
  const repeats = fields.repeat && state.repeats;

  let anchorDate: string | null = null;
  if (fields.anchorDate) {
    if (!state.anchorDate || !isValid(state.anchorDate)) anchorDate = 'budgetPlans.goals.errors.dateRequired';
    else if (state.frequency === 'by_date' && !repeats && format(state.anchorDate, 'yyyy-MM-dd') <= toUtcDay({ now })) {
      anchorDate = 'budgetPlans.goals.errors.dueDateFuture';
    }
  }

  const repeatEvery = state.repeatEvery;
  const repeatValid =
    repeatEvery !== null &&
    Number.isInteger(repeatEvery) &&
    repeatEvery >= 1 &&
    repeatEvery <= GOAL_REPEAT_MAX[state.repeatUnit];

  return {
    amount: isPositive({ value: state.amount }) ? null : amountError,
    anchorDate,
    repeatEvery: repeats && !repeatValid ? 'budgetPlans.goals.errors.repeatEvery' : null,
    stopAtBalance:
      fields.stopAtBalance && state.hasStopAtBalance && !isPositive({ value: state.stopAtBalance })
        ? amountError
        : null,
    fundingCap:
      fields.fundingCap && state.hasFundingCap && !isPositive({ value: state.fundingCap }) ? amountError : null,
  };
};

/** Fields the frequency and behaviour don't use go out as `null`, so an edit clears them. */
export const buildGoalPayload = ({
  state,
  periodId,
}: {
  state: GoalEditorState;
  periodId?: string;
}): SetBudgetLineGoalPayload => {
  const fields = goalEditorFields({ state });
  const repeats = fields.repeat && state.repeats;
  return {
    frequency: state.frequency,
    behavior: state.behavior,
    amount: state.amount ?? 0,
    weekday: fields.weekday ? state.weekday : null,
    anchorDate: fields.anchorDate && state.anchorDate ? format(state.anchorDate, 'yyyy-MM-dd') : null,
    repeatEvery: repeats ? state.repeatEvery : null,
    repeatUnit: repeats ? state.repeatUnit : null,
    stopAtBalance: fields.stopAtBalance && state.hasStopAtBalance ? state.stopAtBalance : null,
    fundingCap: fields.fundingCap && state.hasFundingCap ? state.fundingCap : null,
    ...(periodId && { periodId }),
  };
};

/** The editor's summary sentence; `null` until the editor has what it needs. */
export const goalSummary = ({ state, unit }: { state: GoalEditorState; unit: GoalPeriodUnit }): GoalTextPart | null => {
  if (!isPositive({ value: state.amount })) return null;
  const amount = { money: state.amount! };
  if (state.frequency === 'open_ended') return { key: 'budgetPlans.goals.summary.open_ended', params: { amount } };

  let when: GoalTextPart;
  switch (state.frequency) {
    case 'every_period':
      when = { key: `budgetPlans.goals.unit.${unit}.each` };
      break;
    case 'weekly':
      when = {
        key: 'budgetPlans.goals.when.eachWeekOn',
        params: { weekday: { weekday: state.weekday } },
      };
      break;
    case 'biweekly':
      when = { key: 'budgetPlans.goals.when.everyTwoWeeks' };
      break;
    case 'yearly':
      when = { key: 'budgetPlans.goals.when.eachYear' };
      break;
    case 'by_date': {
      if (!state.anchorDate || !isValid(state.anchorDate)) return null;
      const date = {
        date: format(state.anchorDate, 'yyyy-MM-dd'),
        pattern: GOAL_FULL_DATE_PATTERN,
      };
      if (state.behavior === 'reach_balance')
        return {
          key: 'budgetPlans.goals.summary.by_date',
          params: { amount, date },
        };
      when =
        state.repeats && state.repeatEvery
          ? {
              key: `budgetPlans.goals.when.byDateRepeating.${state.repeatUnit}`,
              params: { date, count: { value: state.repeatEvery } },
            }
          : { key: 'budgetPlans.goals.when.byDate', params: { date } };
      break;
    }
  }
  const behavior = state.behavior === 'refill_up_to' ? 'refill_up_to' : 'budget_another';
  return {
    key: `budgetPlans.goals.summary.${behavior}`,
    params: { amount, when: { part: when } },
  };
};

/** Keeps the input order inside each section. A line pointing at an unknown group counts as ungrouped. */
export const groupLines = <T extends { groupId: string | null }, G extends { id: string }>({
  lines,
  groups,
}: {
  lines: T[];
  groups: G[];
}) => {
  const linesByGroup = new Map(groups.map((group) => [group.id, [] as T[]]));
  const ungrouped: T[] = [];
  for (const line of lines) {
    const bucket = line.groupId ? linesByGroup.get(line.groupId) : undefined;
    (bucket ?? ungrouped).push(line);
  }
  return {
    ungrouped,
    groups: groups.map((group) => ({
      group,
      lines: linesByGroup.get(group.id)!,
    })),
  };
};

export const sumLineTotals = ({
  lines,
}: {
  lines: Pick<BudgetPlanPeriodViewLine, 'carriedIn' | 'assigned' | 'activity' | 'available'>[];
}) =>
  lines.reduce(
    (sum, line) => ({
      carriedIn: sum.carriedIn + line.carriedIn,
      assigned: sum.assigned + line.assigned,
      activity: sum.activity + line.activity,
      available: sum.available + line.available,
    }),
    { carriedIn: 0, assigned: 0, activity: 0, available: 0 },
  );

export interface LayoutLine {
  id: string;
  name: string;
}

export interface LayoutState {
  ungrouped: LayoutLine[];
  groups: { id: string; name: string; lines: LayoutLine[] }[];
}

/** Archived lines stay out: the layout endpoint leaves unlisted lines where they are. */
export const layoutStateFrom = ({
  lines,
  groups,
}: {
  lines: Pick<BudgetPlanLineEntry, 'id' | 'name' | 'sortOrder' | 'groupId' | 'activeUntil'>[];
  groups: { id: string; name: string }[];
}): LayoutState => {
  const live = lines.filter((line) => line.activeUntil === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const toLayoutLine = ({ id, name }: LayoutLine): LayoutLine => ({ id, name });
  const sections = groupLines({ lines: live, groups });
  return {
    ungrouped: sections.ungrouped.map(toLayoutLine),
    groups: sections.groups.map(({ group, lines: groupLinesList }) => ({
      id: group.id,
      name: group.name,
      lines: groupLinesList.map(toLayoutLine),
    })),
  };
};

export const buildLayoutPayload = ({ state }: { state: LayoutState }): SetBudgetPlanLayoutPayload => ({
  groups: state.groups.map((group) => ({
    id: group.id,
    lineIds: group.lines.map((line) => line.id),
  })),
  ungroupedLineIds: state.ungrouped.map((line) => line.id),
});
