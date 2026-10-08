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
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import type Balances from '@models/balances.model';
import {
  serializeBalanceHistory,
  serializeCashFlow,
  serializeCombinedBalanceHistory,
  serializeCumulativeData,
  serializeExpensesAmountForPeriod,
  serializeInvestmentContributions,
  serializeVentureContributions,
  serializeNetWorthDrivers,
  serializeNetWorthHistory,
  serializePivotReport,
  serializeSpendingsByCategories,
  serializeSpendingsByCategoriesByType,
  serializeTotalBalance,
} from '@root/serializers';
import * as statsService from '@services/stats';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { isValid } from 'date-fns';
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

export const getBalanceHistory = createController(balanceHistorySchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, accountId } = query;

  let balanceHistory: Balances[];
  if (accountId) {
    balanceHistory = await statsService.getBalanceHistoryForAccount({
      userId,
      from,
      to,
      accountId,
    });
  } else {
    balanceHistory = await statsService.getBalanceHistory({
      userId,
      accountScope: 'accessible',
      from,
      to,
    });
  }

  // Serialize: convert cents to decimal for API response
  return { data: serializeBalanceHistory(balanceHistory) };
});

const totalBalanceSchema = z.object({
  query: z.object({
    date: z.string(),
  }),
});

export const getTotalBalance = createController(totalBalanceSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { date } = query;

  if (!isValid(new Date(date))) {
    throw new ValidationError({ message: t({ key: 'validation.dateInvalid' }) });
  }

  const settings = await getUserSettings({ userId });

  const totalBalance = await statsService.getTotalBalance({
    userId,
    date,
    includeCreditLimit: settings.includeCreditLimitInStats,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeTotalBalance(totalBalance) };
});

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
  const { id: userId } = user;
  const {
    from,
    to,
    accountId,
    accountIds,
    payeeIds,
    excludedPayeeIds,
    tagIds,
    excludedTagIds,
    type: transactionType,
    categoryIds,
    excludedCategoryIds,
    groupByType,
    excludePlanned,
  } = query;

  if (groupByType) {
    const byType = await statsService.getSpendingsByCategoriesByType(
      removeUndefinedKeys({
        userId,
        from,
        to,
        accountId,
        accountIds,
        payeeIds,
        excludedPayeeIds,
        tagIds,
        excludedTagIds,
        categoryIds,
        excludedCategoryIds,
        excludePlanned,
      }),
    );

    // Serialize: convert cents to decimal for API response
    return { data: serializeSpendingsByCategoriesByType(byType) };
  }

  const result = await statsService.getSpendingsByCategories(
    removeUndefinedKeys({
      userId,
      from,
      to,
      accountId,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
      transactionType,
      categoryIds,
      excludedCategoryIds,
      excludePlanned,
    }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeSpendingsByCategories(result) };
});

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

export const getExpensesAmountForPeriod = createController(expensesAmountSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, accountId, excludedCategoryIds, excludePlanned } = query;

  const result = await statsService.getExpensesAmountForPeriod(
    removeUndefinedKeys({
      userId,
      from,
      to,
      accountId,
      excludedCategoryIds,
      excludePlanned,
    }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeExpensesAmountForPeriod(result) };
});

const combinedBalanceHistorySchema = z.object({
  query: withDateOrder(z.object({ ...dateRange() })),
});

export const getCombinedBalanceHistory = createController(combinedBalanceHistorySchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to } = query;

  const settings = await getUserSettings({ userId });

  const combinedBalanceHistory = await statsService.getCombinedBalanceHistory({
    userId,
    from,
    to,
    includeCreditLimit: settings.includeCreditLimitInStats,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeCombinedBalanceHistory(combinedBalanceHistory) };
});

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
    }),
  ),
});

export const getCashFlow = createController(cashFlowSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const {
    from,
    to,
    granularity,
    accountId,
    accountIds,
    payeeIds,
    excludedPayeeIds,
    tagIds,
    excludedTagIds,
    categoryIds,
    excludedCategoryIds,
    excludePlanned,
  } = query;

  const result = await statsService.getCashFlow(
    removeUndefinedKeys({
      userId,
      from,
      to,
      granularity,
      accountId,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
      categoryIds,
      excludedCategoryIds,
      excludePlanned,
    }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeCashFlow(result) };
});

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

export const getNetWorthDrivers = createController(netWorthDriversSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, granularity, portfolioIds } = query;

  const result = await statsService.getNetWorthDrivers(
    removeUndefinedKeys({ userId, from, to, granularity, portfolioIds }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeNetWorthDrivers(result) };
});

const netWorthHistorySchema = z.object({
  query: withDateOrder(
    z.object({
      ...dateRange({ required: true }),
      granularity: z.enum(NET_WORTH_HISTORY_GRANULARITIES),
    }),
  ),
});

export const getNetWorthHistory = createController(netWorthHistorySchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, granularity } = query;

  const settings = await getUserSettings({ userId });

  const result = await statsService.getNetWorthHistory({
    userId,
    from,
    to,
    granularity,
    includeCreditLimit: settings.includeCreditLimitInStats,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeNetWorthHistory(result) };
});

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

export const getInvestmentContributions = createController(investmentContributionsSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, granularity, portfolioIds } = query;

  const result = await statsService.getInvestmentContributions(
    removeUndefinedKeys({ userId, from, to, granularity, portfolioIds }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeInvestmentContributions(result) };
});

const ventureContributionsSchema = z.object({
  query: withDateOrder(z.object({ ...dateRange({ required: true }) })),
});

export const getVentureContributions = createController(ventureContributionsSchema, async ({ user, query }) => {
  const result = await statsService.getVentureContributions({ userId: user.id, from: query.from, to: query.to });

  return { data: serializeVentureContributions(result) };
});

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

export const getPivotReport = createController(pivotReportSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const { from, to, granularity, rowDimension, measure, accountIds, categoryIds, payeeIds } = query;

  const result = await statsService.getPivotReport(
    removeUndefinedKeys({
      userId,
      from,
      to,
      granularity,
      rowDimension,
      measure,
      accountIds,
      categoryIds,
      payeeIds,
    }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializePivotReport(result) };
});

export const getEarliestTransactionDate = createController(z.object({}), async ({ user }) => {
  const date = await statsService.getEarliestTransactionDate({ userId: user.id });
  return { data: date };
});

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

export const getCumulativeData = createController(cumulativeDataSchema, async ({ user, query }) => {
  const { id: userId } = user;
  const {
    from,
    to,
    metric,
    accountId,
    accountIds,
    payeeIds,
    excludedPayeeIds,
    tagIds,
    excludedTagIds,
    categoryIds,
    excludedCategoryIds,
  } = query;

  const result = await statsService.getCumulativeData(
    removeUndefinedKeys({
      userId,
      from,
      to,
      metric,
      accountId: accountId ?? undefined,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
      categoryIds,
      excludedCategoryIds,
    }),
  );

  // Serialize: convert cents to decimal for API response
  return { data: serializeCumulativeData(result) };
});
