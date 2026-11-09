import { type CashFlowPeriodData } from '@bt/shared/types';
import { endOfQuarter, endOfYear, startOfQuarter, startOfYear } from 'date-fns';

export const BAR_GRANULARITIES = ['monthly', 'quarterly', 'yearly'] as const;
export type BarGranularity = (typeof BAR_GRANULARITIES)[number];

const bucketKey = ({
  periodStart,
  granularity,
}: {
  periodStart: string;
  granularity: Exclude<BarGranularity, 'monthly'>;
}) => {
  const [year = '', month = ''] = periodStart.split('-');
  return granularity === 'yearly' ? year : `${year}-Q${Math.ceil(Number(month) / 3)}`;
};

/** Widens a range to whole buckets so the first and last bars aren't partial. */
export const snapToBuckets = ({ from, to, granularity }: { from: Date; to: Date; granularity: BarGranularity }) => {
  if (granularity === 'quarterly') return { from: startOfQuarter(from), to: endOfQuarter(to) };
  if (granularity === 'yearly') return { from: startOfYear(from), to: endOfYear(to) };
  return { from, to };
};

/** Sums monthly periods into quarters or years. */
export const groupPeriods = ({
  periods,
  granularity,
}: {
  periods: CashFlowPeriodData[];
  granularity: BarGranularity;
}): CashFlowPeriodData[] => {
  if (granularity === 'monthly') return periods;

  const buckets = new Map<string, CashFlowPeriodData>();
  for (const period of periods) {
    const key = bucketKey({ periodStart: period.periodStart, granularity });
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { ...period, categories: period.categories?.map((category) => ({ ...category })) });
      continue;
    }

    bucket.periodEnd = period.periodEnd;
    bucket.income += period.income;
    bucket.expenses += period.expenses;
    bucket.netFlow += period.netFlow;
    for (const category of period.categories ?? []) {
      const existing = bucket.categories?.find((c) => c.categoryId === category.categoryId);
      if (existing) {
        existing.incomeAmount += category.incomeAmount;
        existing.expenseAmount += category.expenseAmount;
      } else {
        (bucket.categories ??= []).push({ ...category });
      }
    }
  }
  return [...buckets.values()];
};
