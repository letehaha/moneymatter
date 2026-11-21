import { BudgetPlanLinePace, TRANSACTION_TYPES } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import BudgetPlans from '@models/budget-plans.model';
import { unskippedScheduleDates } from '@services/subscriptions/get-upcoming-payments';

import { getPlanDailyActivity } from './activity/get-plan-activity';
import { FoldedPeriodView, lineOwnerResolver, periodMembership } from './fold/fold-plan';
import {
  PriorPeriodSpend,
  daysBetween,
  elapsedFraction,
  historyPercent,
  roundPercent,
  schedulePercent,
} from './fold/line-pace';
import type { FoldInput } from './get-period-view';
import { findPlanSubscriptions, planAccountIds, subscriptionAmountInPlanCurrency } from './get-scheduled';

const HISTORY_PERIODS = 3;

type OwnerOf = (categoryId: string) => string | null;

const ownerResolverAt = ({ foldInput, start }: { foldInput: FoldInput; start: string }): OwnerOf =>
  lineOwnerResolver({
    membership: periodMembership({ lines: foldInput.lines, lineCategories: foldInput.lineCategories, start })
      .membership,
    byId: new Map(foldInput.categories.map((category) => [category.id, category])),
  });

const priorSpend = async ({
  plan,
  foldInput,
  index,
  timezone,
}: {
  plan: BudgetPlans;
  foldInput: FoldInput;
  index: number;
  timezone: string;
}): Promise<Map<string, PriorPeriodSpend[]>> => {
  const periods = foldInput.periods.slice(Math.max(0, index - HISTORY_PERIODS), index);
  const rows = await getPlanDailyActivity({ plan, periods, decimals: foldInput.decimals, timezone });

  const byLine = new Map<string, PriorPeriodSpend[]>();
  for (const period of periods) {
    const start = toUtcDateString(period.startDate);
    const ownerOf = ownerResolverAt({ foldInput, start });
    const days = daysBetween({ from: start, until: toUtcDateString(period.endDate) });
    const spends = new Map<string, PriorPeriodSpend>();

    for (const row of rows) {
      if (row.periodId !== period.id || row.categoryId === null) continue;
      const lineId = ownerOf(row.categoryId);
      if (lineId === null) continue;
      const entry = spends.get(lineId) ?? { days, spend: [] };
      entry.spend.push({ offset: row.dayOffset, amount: -row.activity });
      spends.set(lineId, entry);
    }

    for (const [lineId, entry] of spends) byLine.set(lineId, [...(byLine.get(lineId) ?? []), entry]);
  }
  return byLine;
};

/**
 * Minor units per line, expense positive, for every scheduled date of the period:
 * paid ones included, skipped ones left out.
 */
const scheduledOccurrences = async ({
  plan,
  start,
  end,
  ownerOf,
  lineIds,
  today,
  decimals,
}: {
  plan: BudgetPlans;
  start: string;
  end: string;
  ownerOf: OwnerOf;
  lineIds: Set<string>;
  today: string;
  /** The plan currency's decimals. */
  decimals: number;
}): Promise<Map<string, { date: string; amount: number }[]>> => {
  const subscriptions = await findPlanSubscriptions({ plan, accountIds: await planAccountIds({ plan }) });
  const datesOf = await unskippedScheduleDates({ subscriptions, from: start, until: end });

  const byLine = new Map<string, { date: string; amount: number }[]>();
  for (const subscription of subscriptions) {
    if (subscription.transactionType !== TRANSACTION_TYPES.expense || subscription.categoryId === null) continue;
    const lineId = ownerOf(subscription.categoryId);
    if (lineId === null || !lineIds.has(lineId)) continue;

    const dates = datesOf.get(subscription.id) ?? [];
    if (!dates.length) continue;
    const amount = await subscriptionAmountInPlanCurrency({
      plan,
      subscription,
      amount: subscription.expectedAmount!,
      today,
    });
    if (!amount) continue;

    byLine.set(lineId, [
      ...(byLine.get(lineId) ?? []),
      ...dates.map((date) => ({ date, amount: amount.toMinorUnits({ decimals }) })),
    ]);
  }
  return byLine;
};

/**
 * For the current period only, each funded line's expected spend by today:
 * its own recent periods first, then its recurring payments, then time elapsed.
 */
export const periodPaces = async ({
  plan,
  foldInput,
  index,
  view,
  today,
  timezone,
}: {
  plan: BudgetPlans;
  foldInput: FoldInput;
  index: number;
  view: FoldedPeriodView;
  today: string;
  timezone: string;
}): Promise<Map<string, BudgetPlanLinePace>> => {
  const paces = new Map<string, BudgetPlanLinePace>();
  const funded = new Map(
    view.lines
      .map((line) => [line.lineId, Math.max(0, line.carriedIn) + Math.max(0, line.assigned)] as const)
      .filter(([, amount]) => amount > 0),
  );
  if (!view.period.isCurrent || !funded.size) return paces;

  const { startDate: start, endDate: end } = view.period;
  const fraction = elapsedFraction({ start, end, today });

  const history = await priorSpend({ plan, foldInput, index, timezone });
  for (const lineId of funded.keys()) {
    const percent = historyPercent({ periods: history.get(lineId) ?? [], fraction });
    if (percent !== null) paces.set(lineId, { basis: 'history', expectedPercent: roundPercent({ value: percent }) });
  }

  const rest = new Set([...funded.keys()].filter((lineId) => !paces.has(lineId)));
  const scheduled = rest.size
    ? await scheduledOccurrences({
        plan,
        start,
        end,
        ownerOf: ownerResolverAt({ foldInput, start }),
        lineIds: rest,
        today,
        decimals: foldInput.decimals,
      })
    : new Map<string, { date: string; amount: number }[]>();

  for (const lineId of rest) {
    const percent = schedulePercent({
      occurrences: scheduled.get(lineId) ?? [],
      today,
      funded: funded.get(lineId)!,
      fraction,
    });
    paces.set(
      lineId,
      percent === null
        ? { basis: 'even', expectedPercent: roundPercent({ value: fraction * 100 }) }
        : { basis: 'schedule', expectedPercent: roundPercent({ value: percent }) },
    );
  }
  return paces;
};
