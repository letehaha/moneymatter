import type { CashFlowPeriodData, GetVentureContributionsResponse } from '@bt/shared/types';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { sum } from 'lodash-es';

import { savingsRatePct } from './fire-math';

export const FIRE_SEED_MIN_MONTHS = 3;

export const getFireSeedWindow = ({ now }: { now: Date }) => ({
  from: startOfMonth(subMonths(now, 12)),
  to: endOfMonth(subMonths(now, 1)),
});

const median = ({ values }: { values: number[] }) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type SeedPeriod = Pick<CashFlowPeriodData, 'periodStart' | 'income' | 'expenses' | 'netFlow'>;

/** Window periods from the first month with any cash flow; venture contributions must cover the same span. */
export const getFireSeedPeriods = <T extends SeedPeriod>({ periods, now }: { periods: T[]; now: Date }): T[] => {
  const window = getFireSeedWindow({ now });
  const from = format(window.from, 'yyyy-MM-dd');
  const to = format(window.to, 'yyyy-MM-dd');
  const inWindow = periods.filter((p) => p.periodStart >= from && p.periodStart <= to);
  const firstActive = inWindow.findIndex((p) => p.income > 0 || p.expenses > 0);
  return firstActive === -1 ? [] : inWindow.slice(firstActive);
};

export const deriveFireSeed = ({
  periods,
  excludedCategoryExpenseByPeriod,
  ventureContributions,
  now,
}: {
  periods: SeedPeriod[];
  excludedCategoryExpenseByPeriod: Record<string, number>;
  ventureContributions: GetVentureContributionsResponse;
  now: Date;
}) => {
  const used = getFireSeedPeriods({ periods, now });
  const monthsUsed = used.length;

  if (monthsUsed < FIRE_SEED_MIN_MONTHS) {
    return {
      spending: null,
      contribution: 0,
      contributionWasNegative: false,
      savingsRate: null,
      monthsUsed,
      typicalMonth: null,
    };
  }

  const income = sum(used.map((p) => p.income));
  const totalExpenses = sum(used.map((p) => p.expenses));
  const spendingByMonth = used.map((p) => p.expenses - (excludedCategoryExpenseByPeriod[p.periodStart] ?? 0));
  const ventures = sum(ventureContributions.map((v) => v.amount));
  const rawContribution = (sum(used.map((p) => p.netFlow)) - ventures) / monthsUsed;
  const spending = (sum(spendingByMonth) / monthsUsed) * 12;

  return {
    spending: spending > 0 ? spending : null,
    contribution: Math.max(0, rawContribution),
    contributionWasNegative: rawContribution < 0,
    savingsRate: savingsRatePct({ income, expenses: totalExpenses }),
    monthsUsed,
    typicalMonth: median({ values: spendingByMonth }),
  };
};
