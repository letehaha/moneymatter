import { cn } from '@/lib/utils';
import {
  type AccountModel,
  BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES,
  BUDGET_PLAN_CARRY_POLICIES,
  type BudgetAssignmentScope,
  type BudgetPlanCadence,
  type BudgetPlanCarryPolicy,
  type BudgetPlanLineEntry,
  type BudgetPlanPeriod,
  type BudgetPlanPeriodViewLine,
  type BudgetPlanTypeKey,
  type CreateBudgetPlanPayload,
  type SetBudgetPlanAssignmentPayload,
} from '@bt/shared/types';
import { type Locale, format, getDate, isSameMonth, isSameYear, parseISO, subDays } from 'date-fns';

export const BUDGET_CADENCE_PRESETS = ['monthly', 'semiMonthly', 'biweekly', 'weekly'] as const;
export type BudgetCadencePreset = (typeof BUDGET_CADENCE_PRESETS)[number];

const BIWEEKLY_INTERVAL_DAYS = 14;
const WEEKLY_INTERVAL_DAYS = 7;
const HALF_MONTH_DAYS = 15;

export const OVERSPEND_WARNING_RATIO = 0.8;

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
}: {
  name: string;
  preset: BudgetCadencePreset;
  startsOn: Date;
  accountIds: string[];
  carryPolicy: BudgetPlanCarryPolicy;
}): CreateBudgetPlanPayload => {
  const type: BudgetPlanTypeKey = 'category_caps';
  const anchorDate = format(startsOn, 'yyyy-MM-dd');
  // Today is never sent: a client ahead of UTC would trip the backend's epoch-in-future check.
  const isBackdated = anchorDate < format(new Date(), 'yyyy-MM-dd');
  const base = { name, type, accountIds, carryPolicy, ...(isBackdated && { epochDate: anchorDate }) };
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
      return { ...base, cadence: 'days', intervalN: BIWEEKLY_INTERVAL_DAYS, anchorDate };
    case 'weekly':
      return { ...base, cadence: 'days', intervalN: WEEKLY_INTERVAL_DAYS, anchorDate };
  }
};

export const CARRY_POLICY_OPTIONS = BUDGET_PLAN_CARRY_POLICIES.map((value) => ({
  value,
  labelKey: `budgetPlans.carryPolicy.${value}`,
}));

export const buildCarryOptions = ({ t }: { t: (key: string) => string }) =>
  CARRY_POLICY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));

export const isAttachableAccount = (account: AccountModel) =>
  BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES.includes(account.accountCategory) &&
  (!account.share || account.share.isOwner);

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

export const spentOf = ({ line }: { line: Pick<BudgetPlanPeriodViewLine, 'activity'> }) => Math.max(0, -line.activity);

export const progressOf = ({ line }: { line: Pick<BudgetPlanPeriodViewLine, 'assigned' | 'activity'> }) => {
  if (line.assigned <= 0) return { width: '0%', class: 'bg-primary' };
  const ratio = spentOf({ line }) / line.assigned;
  return {
    width: `${Math.min(100, ratio * 100)}%`,
    class: ratio > 1 ? 'bg-app-expense-color' : ratio >= OVERSPEND_WARNING_RATIO ? 'bg-warning' : 'bg-primary',
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
