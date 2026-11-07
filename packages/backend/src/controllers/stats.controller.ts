import {
  CASH_FLOW_GRANULARITIES,
  CUMULATIVE_METRICS,
  INVESTMENT_CONTRIBUTIONS_GRANULARITIES,
  NET_WORTH_DRIVERS_GRANULARITIES,
  NET_WORTH_HISTORY_GRANULARITIES,
  PIVOT_GRANULARITIES,
  PIVOT_MEASURES,
  PIVOT_ROW_DIMENSIONS,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import {
  booleanQuery,
  dateRange,
  optionalCommaSeparatedIds,
  recordId,
  withDateOrder,
} from '@common/lib/zod/custom-types';
import { getBalanceHistoryReport } from '@services/stats/reports/balance-history.report';
import { getCashFlowReport } from '@services/stats/reports/cash-flow.report';
import { getCombinedBalanceHistoryReport } from '@services/stats/reports/combined-balance-history.report';
import { getCumulativeDataReport } from '@services/stats/reports/cumulative-data.report';
import { getEarliestTransactionDateReport } from '@services/stats/reports/earliest-transaction-date.report';
import { getExpensesAmountForPeriodReport } from '@services/stats/reports/expenses-amount-for-period.report';
import { getInvestmentContributionsReport } from '@services/stats/reports/investment-contributions.report';
import { getNetWorthDriversReport } from '@services/stats/reports/net-worth-drivers.report';
import { getNetWorthHistoryReport } from '@services/stats/reports/net-worth-history.report';
import { getPivotTableReport } from '@services/stats/reports/pivot.report';
import {
  getMonthlySpendingsByCategoriesReport,
  getSpendingsByCategoriesByTypeReport,
  getSpendingsByCategoriesReport,
} from '@services/stats/reports/spendings-by-categories.report';
import { getTotalBalanceReport } from '@services/stats/reports/total-balance.report';
import { getVentureContributionsReport } from '@services/stats/reports/venture-contributions.report';
import { z } from 'zod';

import { createController } from './helpers/controller-factory';

const statsScopeQuery = {
  accountIds: optionalCommaSeparatedIds(),
  payeeIds: optionalCommaSeparatedIds(),
  excludedPayeeIds: optionalCommaSeparatedIds(),
  tagIds: optionalCommaSeparatedIds(),
  excludedTagIds: optionalCommaSeparatedIds(),
};

const balanceHistorySchema = z.object({
  query: withDateOrder(z.object({ ...dateRange(), accountId: recordId().optional() })),
});

export const getBalanceHistory = createController(balanceHistorySchema, async ({ user, query }) => ({
  data: await getBalanceHistoryReport({ userId: user.id, ...query }),
}));

const totalBalanceSchema = z.object({
  query: z.object({
    date: z.string(),
  }),
});

export const getTotalBalance = createController(totalBalanceSchema, async ({ user, query }) => ({
  data: await getTotalBalanceReport({ userId: user.id, date: query.date }),
}));

const spendingsByCategoriesSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange(),
      accountId: z.string().optional(),
      ...statsScopeQuery,
      type: z.enum(Object.values(TRANSACTION_TYPES)).optional(),
      categoryIds: optionalCommaSeparatedIds(),
      excludedCategoryIds: optionalCommaSeparatedIds(),
      // When true, ignores `type` and returns per-category income + expense buckets in one response.
      groupByType: booleanQuery().optional(),
      excludePlanned: booleanQuery().optional(),
    }),
  ),
});

export const getSpendingsByCategories = createController(spendingsByCategoriesSchema, async ({ user, query }) => {
  const { groupByType, type: transactionType, ...filters } = query;
  const params = { userId: user.id, ...filters };

  if (groupByType) {
    return { data: await getSpendingsByCategoriesByTypeReport(params) };
  }

  return { data: await getSpendingsByCategoriesReport({ ...params, transactionType }) };
});

const monthlySpendingsByCategoriesSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      categoryIds: optionalCommaSeparatedIds(),
      excludePlanned: booleanQuery().optional(),
    }),
  ),
});

export const getMonthlySpendingsByCategories = createController(
  monthlySpendingsByCategoriesSchema,
  async ({ user, query }) => {
    const { from, to, categoryIds, excludePlanned } = query;

    return {
      data: await getMonthlySpendingsByCategoriesReport({ userId: user.id, from, to, categoryIds, excludePlanned }),
    };
  },
);

const expensesAmountSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange(),
      accountId: z.string().optional(),
      excludedCategoryIds: optionalCommaSeparatedIds(),
      excludePlanned: booleanQuery().optional(),
    }),
  ),
});

export const getExpensesAmountForPeriod = createController(expensesAmountSchema, async ({ user, query }) => ({
  data: await getExpensesAmountForPeriodReport({ userId: user.id, ...query }),
}));

const combinedBalanceHistorySchema = z.object({
  query: withDateOrder(z.object({ ...dateRange() })),
});

export const getCombinedBalanceHistory = createController(combinedBalanceHistorySchema, async ({ user, query }) => ({
  data: await getCombinedBalanceHistoryReport({ userId: user.id, ...query }),
}));

const cashFlowSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(CASH_FLOW_GRANULARITIES),
      accountId: z.string().optional(),
      ...statsScopeQuery,
      categoryIds: optionalCommaSeparatedIds(),
      excludedCategoryIds: optionalCommaSeparatedIds(),
      excludePlanned: booleanQuery().optional(),
      alignToPayday: booleanQuery().optional(),
    }),
  ),
});

export const getCashFlow = createController(cashFlowSchema, async ({ user, query }) => ({
  data: await getCashFlowReport({ userId: user.id, ...query }),
}));

const netWorthDriversSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(NET_WORTH_DRIVERS_GRANULARITIES),
      // Scopes only the investment slice; ownership + enabled are re-enforced in the
      // service against the user's portfolios, so an unknown id is silently dropped.
      portfolioIds: optionalCommaSeparatedIds(),
    }),
  ),
});

export const getNetWorthDrivers = createController(netWorthDriversSchema, async ({ user, query }) => ({
  data: await getNetWorthDriversReport({ userId: user.id, ...query }),
}));

const netWorthHistorySchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(NET_WORTH_HISTORY_GRANULARITIES),
    }),
  ),
});

export const getNetWorthHistory = createController(netWorthHistorySchema, async ({ user, query }) => ({
  data: await getNetWorthHistoryReport({ userId: user.id, ...query }),
}));

const investmentContributionsSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(INVESTMENT_CONTRIBUTIONS_GRANULARITIES),
      // Scopes only the contributions; ownership + enabled are re-enforced in the
      // service against the user's portfolios, so an unknown id is silently dropped.
      portfolioIds: optionalCommaSeparatedIds(),
    }),
  ),
});

export const getInvestmentContributions = createController(investmentContributionsSchema, async ({ user, query }) => ({
  data: await getInvestmentContributionsReport({ userId: user.id, ...query }),
}));

const ventureContributionsSchema = z.object({
  query: withDateOrder(z.object({ ...dateRange({ required: true }) })),
});

export const getVentureContributions = createController(ventureContributionsSchema, async ({ user, query }) => ({
  data: await getVentureContributionsReport({ userId: user.id, ...query }),
}));

const pivotReportSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(PIVOT_GRANULARITIES),
      rowDimension: z.enum(PIVOT_ROW_DIMENSIONS),
      measure: z.enum(PIVOT_MEASURES),
      accountIds: optionalCommaSeparatedIds(),
      categoryIds: optionalCommaSeparatedIds(),
      payeeIds: optionalCommaSeparatedIds(),
    }),
  ),
});

export const getPivotReport = createController(pivotReportSchema, async ({ user, query }) => ({
  data: await getPivotTableReport({ userId: user.id, ...query }),
}));

export const getEarliestTransactionDate = createController(z.object({}), async ({ user }) => ({
  data: await getEarliestTransactionDateReport({ userId: user.id }),
}));

const cumulativeDataSchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      metric: z.enum(CUMULATIVE_METRICS),
      accountId: z.string().optional(),
      ...statsScopeQuery,
      categoryIds: optionalCommaSeparatedIds(),
      excludedCategoryIds: optionalCommaSeparatedIds(),
    }),
  ),
});

export const getCumulativeData = createController(cumulativeDataSchema, async ({ user, query }) => ({
  data: await getCumulativeDataReport({ userId: user.id, ...query }),
}));
