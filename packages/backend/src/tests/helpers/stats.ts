import {
  BalanceModel,
  type CashFlowGranularity,
  type CumulativeMetric,
  type GetCashFlowResponse,
  type GetCumulativeResponse,
  type GetInvestmentContributionsResponse,
  type GetNetWorthDriversResponse,
  type GetNetWorthHistoryResponse,
  type GetPivotReportResponse,
  type GetVentureContributionsResponse,
  type InvestmentContributionsGranularity,
  type NetWorthDriversGranularity,
  type NetWorthHistoryGranularity,
  type PivotGranularity,
  type PivotMeasure,
  type PivotRowDimension,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import {
  getCombinedBalanceHistory as _getCombinedBalanceHistory,
  getEarliestTransactionDate as _getEarliestTransactionDate,
} from '@root/services/stats';
import * as helpers from '@tests/helpers';
import { format } from 'date-fns';

const appendIdLists = ({ params, lists }: { params: URLSearchParams; lists: Record<string, string[] | undefined> }) => {
  for (const [key, values] of Object.entries(lists)) {
    if (values?.length) params.append(key, values.join(','));
  }
};

export async function getBalanceHistory<R extends boolean | undefined = undefined>({
  from,
  to,
  accountId,
  raw,
}: {
  from?: string;
  to?: string;
  accountId?: string;
  raw?: R;
} = {}) {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (accountId) params.append('accountId', accountId);

  const result = await helpers.makeRequest<BalanceModel[], R>({
    method: 'get',
    url: `/stats/balance-history${params.toString() ? `?${params.toString()}` : ''}`,
    raw,
  });

  return result;
}

const dateKey = (date: string | Date) => (typeof date === 'string' ? date.slice(0, 10) : format(date, 'yyyy-MM-dd'));

/** What the chart reads on `date`: the latest row dated on or before it, in cents. */
export const balanceCentsOn = ({ rows, date }: { rows: { date: string | Date; amount: unknown }[]; date: Date }) => {
  const key = format(date, 'yyyy-MM-dd');
  const latest = rows
    .filter((row) => dateKey(row.date) <= key)
    .toSorted((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))
    .at(-1);

  return latest ? Math.round(Number(latest.amount) * 100) : 0;
};

export const getSpendingsByCategories = async ({
  raw = false,
  from,
  to,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
  categoryIds,
  excludedCategoryIds,
  type,
  groupByType,
  excludePlanned,
}: {
  raw?: boolean;
  from?: string;
  to?: string;
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  type?: TRANSACTION_TYPES;
  groupByType?: boolean;
  excludePlanned?: boolean;
} = {}) => {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  appendIdLists({ params, lists: { accountIds, payeeIds, excludedPayeeIds, tagIds, excludedTagIds } });
  if (categoryIds && categoryIds.length > 0) params.append('categoryIds', categoryIds.join(','));
  if (excludedCategoryIds && excludedCategoryIds.length > 0) {
    params.append('excludedCategoryIds', excludedCategoryIds.join(','));
  }
  if (type) params.append('type', type);
  if (groupByType) params.append('groupByType', 'true');
  if (excludePlanned !== undefined) params.append('excludePlanned', String(excludePlanned));

  const result = await helpers.makeRequest({
    method: 'get',
    url: `/stats/spendings-by-categories${params.toString() ? `?${params.toString()}` : ''}`,
  });

  return raw ? helpers.extractResponse(result) : result;
};

export async function getExpensesAmountForPeriod<R extends boolean | undefined = undefined>({
  from,
  to,
  excludedCategoryIds,
  excludePlanned,
  raw,
}: {
  from?: string;
  to?: string;
  excludedCategoryIds?: string[];
  excludePlanned?: boolean;
  raw?: R;
}) {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (excludedCategoryIds && excludedCategoryIds.length > 0) {
    params.append('excludedCategoryIds', excludedCategoryIds.join(','));
  }
  if (excludePlanned !== undefined) params.append('excludePlanned', String(excludePlanned));

  const result = await helpers.makeRequest<number, R>({
    method: 'get',
    url: `/stats/expenses-amount-for-period${params.toString() ? `?${params.toString()}` : ''}`,
    raw,
  });

  return result;
}

export async function getEarliestTransactionDate<R extends boolean | undefined = undefined>({
  raw,
}: {
  raw?: R;
} = {}) {
  const result = await helpers.makeRequest<Awaited<ReturnType<typeof _getEarliestTransactionDate>>, R>({
    method: 'get',
    url: '/stats/earliest-transaction-date',
    raw,
  });

  return result;
}

export async function getCashFlow<R extends boolean | undefined = undefined>({
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
  raw,
}: {
  from: string;
  to: string;
  granularity: CashFlowGranularity;
  accountId?: string;
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  excludePlanned?: boolean;
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('granularity', granularity);
  if (accountId) params.append('accountId', accountId);
  appendIdLists({ params, lists: { accountIds, payeeIds, excludedPayeeIds, tagIds, excludedTagIds } });
  if (categoryIds && categoryIds.length > 0) params.append('categoryIds', categoryIds.join(','));
  if (excludedCategoryIds && excludedCategoryIds.length > 0) {
    params.append('excludedCategoryIds', excludedCategoryIds.join(','));
  }
  if (excludePlanned !== undefined) params.append('excludePlanned', String(excludePlanned));

  const result = await helpers.makeRequest<GetCashFlowResponse, R>({
    method: 'get',
    url: `/stats/cash-flow?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getNetWorthDrivers<R extends boolean | undefined = undefined>({
  from,
  to,
  granularity,
  portfolioIds,
  raw,
}: {
  from: string;
  to: string;
  granularity: NetWorthDriversGranularity;
  portfolioIds?: string[];
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('granularity', granularity);
  if (portfolioIds && portfolioIds.length > 0) params.append('portfolioIds', portfolioIds.join(','));

  const result = await helpers.makeRequest<GetNetWorthDriversResponse, R>({
    method: 'get',
    url: `/stats/net-worth-drivers?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getNetWorthHistory<R extends boolean | undefined = undefined>({
  from,
  to,
  granularity,
  raw,
}: {
  from: string;
  to: string;
  granularity: NetWorthHistoryGranularity;
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('granularity', granularity);

  const result = await helpers.makeRequest<GetNetWorthHistoryResponse, R>({
    method: 'get',
    url: `/stats/net-worth-history?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getInvestmentContributions<R extends boolean | undefined = undefined>({
  from,
  to,
  granularity,
  portfolioIds,
  raw,
}: {
  from: string;
  to: string;
  granularity: InvestmentContributionsGranularity;
  portfolioIds?: string[];
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('granularity', granularity);
  if (portfolioIds && portfolioIds.length > 0) params.append('portfolioIds', portfolioIds.join(','));

  const result = await helpers.makeRequest<GetInvestmentContributionsResponse, R>({
    method: 'get',
    url: `/stats/investment-contributions?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getVentureContributions<R extends boolean | undefined = undefined>({
  from,
  to,
  raw,
}: {
  from: string;
  to: string;
  raw?: R;
}) {
  return helpers.makeRequest<GetVentureContributionsResponse, R>({
    method: 'get',
    url: `/stats/venture-contributions?from=${from}&to=${to}`,
    raw,
  });
}

export async function getPivotReport<R extends boolean | undefined = undefined>({
  from,
  to,
  granularity,
  rowDimension,
  measure,
  accountIds,
  categoryIds,
  payeeIds,
  raw,
}: {
  from: string;
  to: string;
  granularity: PivotGranularity;
  rowDimension: PivotRowDimension;
  measure: PivotMeasure;
  accountIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('granularity', granularity);
  params.append('rowDimension', rowDimension);
  params.append('measure', measure);
  if (accountIds && accountIds.length > 0) params.append('accountIds', accountIds.join(','));
  if (categoryIds && categoryIds.length > 0) params.append('categoryIds', categoryIds.join(','));
  if (payeeIds && payeeIds.length > 0) params.append('payeeIds', payeeIds.join(','));

  const result = await helpers.makeRequest<GetPivotReportResponse, R>({
    method: 'get',
    url: `/stats/pivot?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getCumulativeData<R extends boolean | undefined = undefined>({
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
  raw,
}: {
  from: string;
  to: string;
  metric: CumulativeMetric;
  accountId?: string;
  accountIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  params.append('metric', metric);
  if (accountId) params.append('accountId', accountId);
  appendIdLists({ params, lists: { accountIds, payeeIds, excludedPayeeIds, tagIds, excludedTagIds } });
  if (categoryIds && categoryIds.length > 0) params.append('categoryIds', categoryIds.join(','));
  if (excludedCategoryIds && excludedCategoryIds.length > 0) {
    params.append('excludedCategoryIds', excludedCategoryIds.join(','));
  }

  const result = await helpers.makeRequest<GetCumulativeResponse, R>({
    method: 'get',
    url: `/stats/cumulative?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getTotalBalance<R extends boolean | undefined = undefined>({
  date,
  raw,
}: {
  date: string;
  raw?: R;
}) {
  const params = new URLSearchParams();
  params.append('date', date);

  const result = await helpers.makeRequest<number, R>({
    method: 'get',
    url: `/stats/total-balance?${params.toString()}`,
    raw,
  });

  return result;
}

export async function getCombinedBalanceHistory<R extends boolean | undefined = undefined>({
  from,
  to,
  raw,
}: {
  from?: string;
  to?: string;
  raw?: R;
}) {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const result = await helpers.makeRequest<Awaited<ReturnType<typeof _getCombinedBalanceHistory>>, R>({
    method: 'get',
    url: `/stats/combined-balance-history${params.toString() ? `?${params.toString()}` : ''}`,
    raw,
  });

  return result;
}
