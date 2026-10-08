import { api } from '@/api/_api';
import type {
  TRANSACTION_TYPES,
  GetBalanceHistoryPayload,
  GetSpendingsByCategoriesReturnType,
  GetSpendingsByCategoriesByTypeReturnType,
  CashFlowGranularity,
  GetCashFlowResponse,
  NetWorthDriversGranularity,
  GetNetWorthDriversResponse,
  NetWorthHistoryGranularity,
  GetNetWorthHistoryResponse,
  InvestmentContributionsGranularity,
  GetInvestmentContributionsResponse,
  GetVentureContributionsResponse,
  PivotGranularity,
  PivotRowDimension,
  PivotMeasure,
  GetPivotReportResponse,
  CumulativeMetric,
  GetCumulativeResponse,
} from '@bt/shared/types';
import { format } from 'date-fns';

const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');

const commaJoinedIds = (lists: Record<string, string[] | undefined>): Record<string, string> => {
  const params: Record<string, string> = {};

  for (const [key, ids] of Object.entries(lists)) {
    if (ids?.length) params[key] = ids.join(',');
  }

  return params;
};

interface Params {
  accountId?: GetBalanceHistoryPayload['accountId'];
  from?: Date;
  to?: Date;
}

export interface BalanceHistoryEntity {
  date: string;
  amount: number;
  accountId: string;
}

export const getExpensesAmountForPeriod = async ({
  from,
  to,
  excludedCategoryIds,
  excludePlanned,
  ...rest
}: Params & { excludedCategoryIds?: string[]; excludePlanned?: boolean } = {}): Promise<number> => {
  const params: GetBalanceHistoryPayload & { excludedCategoryIds?: string; excludePlanned?: string } = {
    ...rest,
  };

  if (from) params.from = formatDate(from);
  if (to) params.to = formatDate(to);
  if (excludedCategoryIds && excludedCategoryIds.length > 0) params.excludedCategoryIds = excludedCategoryIds.join(',');
  if (excludePlanned) params.excludePlanned = 'true';

  return api.get('/stats/expenses-amount-for-period', params);
};

export const getSpendingsByCategories = async ({
  from,
  to,
  type,
  categoryIds,
  excludedCategoryIds,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
  excludePlanned,
  ...rest
}: Params & {
  type?: TRANSACTION_TYPES;
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  excludePlanned?: boolean;
} = {}): Promise<GetSpendingsByCategoriesReturnType> => {
  const params: GetBalanceHistoryPayload & {
    type?: string;
    categoryIds?: string;
    excludedCategoryIds?: string;
    accountIds?: string;
    payeeIds?: string;
    excludedPayeeIds?: string;
    tagIds?: string;
    excludedTagIds?: string;
    excludePlanned?: string;
  } = {
    ...rest,
  };

  if (from) params.from = formatDate(from);
  if (to) params.to = formatDate(to);
  if (type) params.type = type;
  if (excludePlanned) params.excludePlanned = 'true';

  Object.assign(
    params,
    commaJoinedIds({
      categoryIds,
      excludedCategoryIds,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
    }),
  );

  return api.get('/stats/spendings-by-categories', params);
};

export const getSpendingsByCategoriesByType = async ({
  from,
  to,
  categoryIds,
  excludedCategoryIds,
  excludePlanned,
  ...rest
}: Params & {
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  excludePlanned?: boolean;
} = {}): Promise<GetSpendingsByCategoriesByTypeReturnType> => {
  const params: Record<string, string | boolean> = { groupByType: true };

  if (rest.accountId) params.accountId = rest.accountId;
  if (from) params.from = formatDate(from);
  if (to) params.to = formatDate(to);
  if (categoryIds && categoryIds.length > 0) params.categoryIds = categoryIds.join(',');
  if (excludedCategoryIds && excludedCategoryIds.length > 0) params.excludedCategoryIds = excludedCategoryIds.join(',');
  if (excludePlanned) params.excludePlanned = true;

  return api.get('/stats/spendings-by-categories', params);
};

export interface CombinedBalanceHistoryEntity {
  date: string;
  accountsBalance: number;
  portfoliosBalance: number;
  venturesBalance: number;
  vehiclesBalance: number;
  loansBalance: number;
  totalBalance: number;
}

export const getCombinedBalanceHistory = async ({ from, to }: { from?: Date; to?: Date } = {}): Promise<
  CombinedBalanceHistoryEntity[]
> => {
  const params: { from?: string; to?: string } = {};

  if (from) params.from = formatDate(from);
  if (to) params.to = formatDate(to);

  return api.get('/stats/combined-balance-history', params);
};

export const getEarliestTransactionDate = async (): Promise<string | null> => {
  return api.get('/stats/earliest-transaction-date');
};

interface GetCashFlowParams {
  from: Date;
  to: Date;
  granularity: CashFlowGranularity;
  accountId?: string;
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  excludePlanned?: boolean;
}

export const getCashFlow = async ({
  from,
  to,
  granularity,
  accountId,
  categoryIds,
  excludedCategoryIds,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
  excludePlanned,
}: GetCashFlowParams): Promise<GetCashFlowResponse> => {
  const params: Record<string, string | number | boolean> = {
    from: formatDate(from),
    to: formatDate(to),
    granularity,
  };

  if (accountId !== undefined) params.accountId = accountId;
  if (excludePlanned) params.excludePlanned = true;

  Object.assign(
    params,
    commaJoinedIds({
      categoryIds,
      excludedCategoryIds,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
    }),
  );

  return api.get('/stats/cash-flow', params);
};

interface GetNetWorthDriversParams {
  from: Date;
  to: Date;
  granularity: NetWorthDriversGranularity;
  /** Subset of enabled portfolios to scope the investment slice to. Omitted/empty = all. */
  portfolioIds?: string[];
}

export const getNetWorthDrivers = async ({
  from,
  to,
  granularity,
  portfolioIds,
}: GetNetWorthDriversParams): Promise<GetNetWorthDriversResponse> => {
  const params: Record<string, string> = {
    from: formatDate(from),
    to: formatDate(to),
    granularity,
  };

  if (portfolioIds && portfolioIds.length > 0) params.portfolioIds = portfolioIds.join(',');

  return api.get('/stats/net-worth-drivers', params);
};

interface GetNetWorthHistoryParams {
  from: Date;
  to: Date;
  granularity: NetWorthHistoryGranularity;
}

/** Assets/liabilities/net-worth snapshots per bucket — signed decimals in base currency. */
export const getNetWorthHistory = async ({
  from,
  to,
  granularity,
}: GetNetWorthHistoryParams): Promise<GetNetWorthHistoryResponse> => {
  const params: Record<string, string> = {
    from: formatDate(from),
    to: formatDate(to),
    granularity,
  };

  return api.get('/stats/net-worth-history', params);
};

interface GetInvestmentContributionsParams {
  from: Date;
  to: Date;
  granularity: InvestmentContributionsGranularity;
  /** Subset of enabled portfolios to scope the contributions to. Omitted/empty = all. */
  portfolioIds?: string[];
}

export const getInvestmentContributions = async ({
  from,
  to,
  granularity,
  portfolioIds,
}: GetInvestmentContributionsParams): Promise<GetInvestmentContributionsResponse> => {
  const params: Record<string, string> = {
    from: formatDate(from),
    to: formatDate(to),
    granularity,
  };

  if (portfolioIds && portfolioIds.length > 0) params.portfolioIds = portfolioIds.join(',');

  return api.get('/stats/investment-contributions', params);
};

export const getVentureContributions = async ({
  from,
  to,
}: {
  from: Date;
  to: Date;
}): Promise<GetVentureContributionsResponse> =>
  api.get('/stats/venture-contributions', { from: formatDate(from), to: formatDate(to) });

interface GetPivotReportParams {
  from: Date;
  to: Date;
  granularity: PivotGranularity;
  rowDimension: PivotRowDimension;
  measure: PivotMeasure;
  accountIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
}

export const getPivotReport = async ({
  from,
  to,
  granularity,
  rowDimension,
  measure,
  accountIds,
  categoryIds,
  payeeIds,
}: GetPivotReportParams): Promise<GetPivotReportResponse> => {
  const params: Record<string, string> = {
    from: formatDate(from),
    to: formatDate(to),
    granularity,
    rowDimension,
    measure,
  };

  if (accountIds && accountIds.length > 0) params.accountIds = accountIds.join(',');
  if (categoryIds && categoryIds.length > 0) params.categoryIds = categoryIds.join(',');
  if (payeeIds && payeeIds.length > 0) params.payeeIds = payeeIds.join(',');

  return api.get('/stats/pivot', params);
};

interface GetCumulativeDataParams {
  from: Date;
  to: Date;
  metric: CumulativeMetric;
  accountId?: string;
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
}

export const getCumulativeData = async ({
  from,
  to,
  metric,
  accountId,
  categoryIds,
  excludedCategoryIds,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
}: GetCumulativeDataParams): Promise<GetCumulativeResponse> => {
  const params: Record<string, string | number | boolean> = {
    from: formatDate(from),
    to: formatDate(to),
    metric,
  };

  if (accountId !== undefined) params.accountId = accountId;

  Object.assign(
    params,
    commaJoinedIds({
      categoryIds,
      excludedCategoryIds,
      accountIds,
      payeeIds,
      excludedPayeeIds,
      tagIds,
      excludedTagIds,
    }),
  );

  return api.get('/stats/cumulative', params);
};
