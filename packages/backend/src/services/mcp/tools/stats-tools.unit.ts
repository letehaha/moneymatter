import {
  CUMULATIVE_METRICS,
  INVESTMENT_CONTRIBUTIONS_GRANULARITIES,
  NET_WORTH_DRIVERS_GRANULARITIES,
  NET_WORTH_HISTORY_GRANULARITIES,
  PIVOT_GRANULARITIES,
  PIVOT_MEASURES,
  PIVOT_ROW_DIMENSIONS,
  TRANSACTION_TYPES,
  asMinorUnits,
} from '@bt/shared/types';
import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getBalanceHistory } from '@services/stats/get-balance-history';
import { getBalanceHistoryForAccount } from '@services/stats/get-balance-history-for-account';
import { getCashFlow } from '@services/stats/get-cash-flow';
import { getCombinedBalanceHistory } from '@services/stats/get-combined-balance-history';
import { getCumulativeData } from '@services/stats/get-cumulative-data';
import { getEarliestTransactionDate } from '@services/stats/get-earliest-transaction-date';
import { getExpensesAmountForPeriod } from '@services/stats/get-expenses-amount-for-period';
import { getInvestmentContributions } from '@services/stats/get-investment-contributions';
import { getNetWorthDrivers } from '@services/stats/get-net-worth-drivers';
import { getNetWorthHistory } from '@services/stats/get-net-worth-history';
import { getPivotReport } from '@services/stats/get-pivot';
import { getSpendingsByCategories } from '@services/stats/get-spendings-by-categories';
import { getTotalBalance } from '@services/stats/get-total-balance';
import { getVentureContributions } from '@services/stats/get-venture-contributions';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services: their import chains load models and open database pools.
jest.mock('@common/lib/currency-precision', () => ({ getBaseCurrencyDecimals: jest.fn() }));
jest.mock('@services/user-settings/get-user-settings', () => ({ getUserSettings: jest.fn() }));
jest.mock('@services/stats/get-balance-history', () => ({ getBalanceHistory: jest.fn() }));
jest.mock('@services/stats/get-balance-history-for-account', () => ({ getBalanceHistoryForAccount: jest.fn() }));
jest.mock('@services/stats/get-cash-flow', () => ({ getCashFlow: jest.fn() }));
jest.mock('@services/stats/get-combined-balance-history', () => ({ getCombinedBalanceHistory: jest.fn() }));
jest.mock('@services/stats/get-cumulative-data', () => ({ getCumulativeData: jest.fn() }));
jest.mock('@services/stats/get-earliest-transaction-date', () => ({ getEarliestTransactionDate: jest.fn() }));
jest.mock('@services/stats/get-expenses-amount-for-period', () => ({ getExpensesAmountForPeriod: jest.fn() }));
jest.mock('@services/stats/get-investment-contributions', () => ({ getInvestmentContributions: jest.fn() }));
jest.mock('@services/stats/get-net-worth-drivers', () => ({ getNetWorthDrivers: jest.fn() }));
jest.mock('@services/stats/get-net-worth-history', () => ({ getNetWorthHistory: jest.fn() }));
jest.mock('@services/stats/get-pivot', () => ({ getPivotReport: jest.fn() }));
jest.mock('@services/stats/get-spendings-by-categories', () => ({
  getSpendingsByCategories: jest.fn(),
  getSpendingsByCategoriesByType: jest.fn(),
}));
jest.mock('@services/stats/get-total-balance', () => ({ getTotalBalance: jest.fn() }));
jest.mock('@services/stats/get-venture-contributions', () => ({ getVentureContributions: jest.fn() }));

import { registerGetBalanceHistory } from './get-balance-history';
import { registerGetCashFlow } from './get-cash-flow';
import { registerGetCumulativeStats } from './get-cumulative-stats';
import { registerGetEarliestTransactionDate } from './get-earliest-transaction-date';
import { registerGetExpensesForPeriod } from './get-expenses-for-period';
import { registerGetInvestmentContributions } from './get-investment-contributions';
import { registerGetNetWorthDrivers } from './get-net-worth-drivers';
import { registerGetNetWorthHistory } from './get-net-worth-history';
import { registerGetPivotReport } from './get-pivot-report';
import { registerGetSpendingByCategories } from './get-spending-by-categories';
import { registerGetTotalBalance } from './get-total-balance';
import { registerGetVentureContributions } from './get-venture-contributions';

const READ = makeExtra({ scopes: ['finance:read'] });
const DECIMALS = 3;

const decimalsOf = jest.mocked(getBaseCurrencyDecimals);
const settingsOf = jest.mocked(getUserSettings);
const balanceHistory = jest.mocked(getBalanceHistory);
const accountBalanceHistory = jest.mocked(getBalanceHistoryForAccount);
const cashFlow = jest.mocked(getCashFlow);
const combinedHistory = jest.mocked(getCombinedBalanceHistory);
const cumulative = jest.mocked(getCumulativeData);
const earliest = jest.mocked(getEarliestTransactionDate);
const expenses = jest.mocked(getExpensesAmountForPeriod);
const investments = jest.mocked(getInvestmentContributions);
const drivers = jest.mocked(getNetWorthDrivers);
const netWorthHistory = jest.mocked(getNetWorthHistory);
const pivot = jest.mocked(getPivotReport);
const spendings = jest.mocked(getSpendingsByCategories);
const totalBalance = jest.mocked(getTotalBalance);
const ventures = jest.mocked(getVentureContributions);

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const RANGE = { from: '2026-01-01', to: '2026-03-31' };

const tools = captureTools({
  register: [
    registerGetBalanceHistory,
    registerGetCashFlow,
    registerGetCumulativeStats,
    registerGetEarliestTransactionDate,
    registerGetExpensesForPeriod,
    registerGetInvestmentContributions,
    registerGetNetWorthDrivers,
    registerGetNetWorthHistory,
    registerGetPivotReport,
    registerGetSpendingByCategories,
    registerGetTotalBalance,
    registerGetVentureContributions,
  ],
});

const tool = ({ name }: { name: string }) => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} is not registered`);
  return found;
};

/** `jsonContent` unwraps its `data`, so the parsed text is the tool's payload. */
const call = async ({ name, args }: { name: string; args?: unknown }) => {
  const { handler } = tool({ name });
  const data = parseToolResult({ result: await (args === undefined ? handler(READ) : handler(args, READ)) }) as any;
  return { data };
};

const accepts = ({ name, args }: { name: string; args: unknown }) =>
  z.object(tool({ name }).config.inputSchema ?? {}).safeParse(args).success;

const setSettings = ({ includeCreditLimitInStats }: { includeCreditLimitInStats: boolean }) =>
  settingsOf.mockResolvedValue({ includeCreditLimitInStats } as Awaited<ReturnType<typeof getUserSettings>>);

beforeEach(() => {
  jest.resetAllMocks();
  decimalsOf.mockResolvedValue(DECIMALS);
  setSettings({ includeCreditLimitInStats: false });
});

describe('stats tools registration', () => {
  it('registers the eight new report tools next to the four existing ones', () => {
    expect(tools.map((candidate) => candidate.name).toSorted()).toEqual([
      'get_balance_history',
      'get_cash_flow',
      'get_cumulative_stats',
      'get_earliest_transaction_date',
      'get_expenses_for_period',
      'get_investment_contributions',
      'get_net_worth_drivers',
      'get_net_worth_history',
      'get_pivot_report',
      'get_spending_by_categories',
      'get_total_balance',
      'get_venture_contributions',
    ]);
  });
});

describe('enum and date input schemas', () => {
  it.each([
    ['get_net_worth_history', NET_WORTH_HISTORY_GRANULARITIES],
    ['get_net_worth_drivers', NET_WORTH_DRIVERS_GRANULARITIES],
    ['get_investment_contributions', INVESTMENT_CONTRIBUTIONS_GRANULARITIES],
  ] as [string, readonly string[]][])('%s accepts exactly the granularities REST accepts', (name, granularities) => {
    for (const granularity of granularities) expect(accepts({ name, args: { ...RANGE, granularity } })).toBe(true);
    expect(accepts({ name, args: { ...RANGE, granularity: 'hourly' } })).toBe(false);
    expect(accepts({ name, args: { ...RANGE } })).toBe(false);
  });

  it('get_pivot_report accepts the REST granularity, row dimension and measure enums only', () => {
    const base = { ...RANGE, granularity: 'monthly', rowDimension: 'category', measure: 'expense' };

    for (const granularity of PIVOT_GRANULARITIES)
      expect(accepts({ name: 'get_pivot_report', args: { ...base, granularity } })).toBe(true);
    for (const rowDimension of PIVOT_ROW_DIMENSIONS)
      expect(accepts({ name: 'get_pivot_report', args: { ...base, rowDimension } })).toBe(true);
    for (const measure of PIVOT_MEASURES)
      expect(accepts({ name: 'get_pivot_report', args: { ...base, measure } })).toBe(true);

    expect(accepts({ name: 'get_pivot_report', args: { ...base, granularity: 'daily' } })).toBe(false);
    expect(accepts({ name: 'get_pivot_report', args: { ...base, rowDimension: 'account' } })).toBe(false);
    expect(accepts({ name: 'get_pivot_report', args: { ...base, measure: 'net' } })).toBe(false);
  });

  it('get_cumulative_stats accepts the REST metrics only', () => {
    for (const metric of CUMULATIVE_METRICS)
      expect(accepts({ name: 'get_cumulative_stats', args: { ...RANGE, metric } })).toBe(true);
    expect(accepts({ name: 'get_cumulative_stats', args: { ...RANGE, metric: 'balance' } })).toBe(false);
  });

  it('takes ids as arrays and refuses a comma string or a non-uuid', () => {
    const args = { ...RANGE, granularity: 'monthly' };

    expect(accepts({ name: 'get_net_worth_drivers', args: { ...args, portfolioIds: [ID_1, ID_2] } })).toBe(true);
    expect(accepts({ name: 'get_net_worth_drivers', args: { ...args, portfolioIds: `${ID_1},${ID_2}` } })).toBe(false);
    expect(accepts({ name: 'get_net_worth_drivers', args: { ...args, portfolioIds: ['nope'] } })).toBe(false);
  });

  it.each([
    'get_net_worth_history',
    'get_net_worth_drivers',
    'get_investment_contributions',
    'get_venture_contributions',
    'get_pivot_report',
    'get_cumulative_stats',
  ])('%s requires real calendar dates', (name) => {
    const args = { granularity: 'monthly', rowDimension: 'category', measure: 'expense', metric: 'expenses' };

    expect(accepts({ name, args: { ...args, from: '2026-13-45', to: '2026-03-31' } })).toBe(false);
    expect(accepts({ name, args: { ...args, from: '2026-01-01' } })).toBe(false);
  });

  it.each([
    ['get_net_worth_history', { granularity: 'monthly' }],
    ['get_net_worth_drivers', { granularity: 'monthly' }],
    ['get_investment_contributions', { granularity: 'monthly' }],
    ['get_venture_contributions', {}],
    ['get_pivot_report', { granularity: 'monthly', rowDimension: 'category', measure: 'expense' }],
    ['get_cumulative_stats', { metric: 'expenses' }],
  ])('%s refuses an inverted range before reading anything', async (name, extra) => {
    await expect(call({ name, args: { from: '2026-03-31', to: '2026-01-01', ...extra } })).rejects.toThrow(
      /on or before/,
    );

    expect(decimalsOf).not.toHaveBeenCalled();
  });
});

describe('get_balance_history', () => {
  it('applies includeCreditLimitInStats to the combined branch', async () => {
    setSettings({ includeCreditLimitInStats: true });
    combinedHistory.mockResolvedValue([]);

    await call({ name: 'get_balance_history', args: { startDate: '2026-01-01', endDate: '2026-01-31' } });

    expect(combinedHistory).toHaveBeenCalledWith({
      userId: 42,
      from: '2026-01-01',
      to: '2026-01-31',
      includeCreditLimit: true,
      decimals: DECIMALS,
    });
  });

  it('leaves the credit limit out of the combined branch while the setting is off', async () => {
    combinedHistory.mockResolvedValue([]);

    await call({ name: 'get_balance_history', args: { startDate: '2026-01-01', endDate: '2026-01-31' } });

    expect(combinedHistory).toHaveBeenCalledWith(expect.objectContaining({ includeCreditLimit: false }));
  });

  it('returns the combined series as decimals at the base currency precision', async () => {
    combinedHistory.mockResolvedValue([
      {
        date: '2026-01-01',
        accountsBalance: asMinorUnits(1_500),
        portfoliosBalance: asMinorUnits(0),
        venturesBalance: asMinorUnits(0),
        vehiclesBalance: asMinorUnits(0),
        loansBalance: asMinorUnits(-250),
        totalBalance: asMinorUnits(1_250),
      },
    ]);

    const { data } = await call({ name: 'get_balance_history', args: {} });

    expect(data).toEqual([
      {
        date: '2026-01-01',
        accountsBalance: 1.5,
        portfoliosBalance: 0,
        venturesBalance: 0,
        vehiclesBalance: 0,
        loansBalance: -0.25,
        totalBalance: 1.25,
      },
    ]);
  });

  it('reads one account through the account service and ignores the combined one', async () => {
    accountBalanceHistory.mockResolvedValue([
      { date: '2026-01-01', accountId: ID_1, amount: Money.fromDecimal(12.5) } as never,
    ]);

    const { data } = await call({
      name: 'get_balance_history',
      args: { accountId: ID_1, startDate: '2026-01-01', endDate: '2026-01-31' },
    });

    expect(accountBalanceHistory).toHaveBeenCalledWith({
      userId: 42,
      accountId: ID_1,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(combinedHistory).not.toHaveBeenCalled();
    expect(balanceHistory).not.toHaveBeenCalled();
    expect(data).toEqual([{ date: '2026-01-01', accountId: ID_1, amount: 12.5 }]);
  });
});

describe('get_total_balance', () => {
  it('returns the total as a decimal and applies includeCreditLimitInStats', async () => {
    setSettings({ includeCreditLimitInStats: true });
    totalBalance.mockResolvedValue(asMinorUnits(12_345));

    const { data } = await call({ name: 'get_total_balance', args: { date: '2026-02-01' } });

    expect(totalBalance).toHaveBeenCalledWith({
      userId: 42,
      date: '2026-02-01',
      includeCreditLimit: true,
      decimals: DECIMALS,
    });
    expect(data).toBe(12.345);
  });

  it('leaves the credit limit out while the setting is off', async () => {
    totalBalance.mockResolvedValue(asMinorUnits(0));

    await call({ name: 'get_total_balance', args: { date: '2026-02-01' } });

    expect(totalBalance).toHaveBeenCalledWith(expect.objectContaining({ includeCreditLimit: false }));
  });

  it('refuses a date that is not a date, as REST does, before any read', async () => {
    await expect(call({ name: 'get_total_balance', args: { date: 'tomorrow-ish' } })).rejects.toThrow();

    expect(totalBalance).not.toHaveBeenCalled();
  });
});

describe('get_net_worth_history', () => {
  it('passes the range, granularity, credit-limit setting and decimals through', async () => {
    setSettings({ includeCreditLimitInStats: true });
    netWorthHistory.mockResolvedValue({
      points: [
        {
          date: '2026-01-31',
          assets: { cash: asMinorUnits(2_000), investments: 0, vehicles: 0, ventures: 0 },
          assetsTotal: asMinorUnits(2_000),
          liabilities: { loans: asMinorUnits(500) },
          liabilitiesTotal: asMinorUnits(500),
          netWorth: asMinorUnits(1_500),
        },
      ],
    } as never);

    const { data } = await call({ name: 'get_net_worth_history', args: { ...RANGE, granularity: 'monthly' } });

    expect(netWorthHistory).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      granularity: 'monthly',
      includeCreditLimit: true,
      decimals: DECIMALS,
    });
    expect(data.points[0]).toMatchObject({ assetsTotal: 2, liabilitiesTotal: 0.5, netWorth: 1.5 });
    expect(data.points[0].assets.cash).toBe(2);
  });
});

describe('get_net_worth_drivers and get_investment_contributions', () => {
  it('passes the portfolio scope as an array and returns decimals', async () => {
    drivers.mockResolvedValue({
      buckets: [
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          savings: { income: asMinorUnits(3_000), expenses: asMinorUnits(1_000), net: asMinorUnits(2_000) },
          investments: {
            growth: asMinorUnits(500),
            priceEffect: asMinorUnits(400),
            dividends: asMinorUnits(100),
            feesAndTaxes: asMinorUnits(0),
            byPortfolio: [{ portfolioId: ID_1, growth: asMinorUnits(500) }],
          },
          composition: { holdingsValue: asMinorUnits(9_000), cashValue: asMinorUnits(1_000) },
        },
      ],
      portfolios: [{ id: ID_1, name: 'Main' }],
    } as never);

    const { data } = await call({
      name: 'get_net_worth_drivers',
      args: { ...RANGE, granularity: 'monthly', portfolioIds: [ID_1] },
    });

    expect(drivers).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      granularity: 'monthly',
      portfolioIds: [ID_1],
      decimals: DECIMALS,
    });
    expect(data.buckets[0].savings).toEqual({ income: 3, expenses: 1, net: 2 });
    expect(data.buckets[0].investments.byPortfolio).toEqual([{ portfolioId: ID_1, growth: 0.5 }]);
  });

  it('omits portfolioIds from the service call when none is given', async () => {
    drivers.mockResolvedValue({ buckets: [], portfolios: [] });

    await call({ name: 'get_net_worth_drivers', args: { ...RANGE, granularity: 'yearly' } });

    expect(drivers.mock.calls[0]![0]).not.toHaveProperty('portfolioIds');
  });

  it('returns contributions as decimals', async () => {
    investments.mockResolvedValue({
      buckets: [
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          total: asMinorUnits(700),
          byPortfolio: [{ portfolioId: ID_1, amount: asMinorUnits(700) }],
          savingsNet: asMinorUnits(2_000),
        },
      ],
      portfolios: [{ id: ID_1, name: 'Main' }],
    } as never);

    const { data } = await call({
      name: 'get_investment_contributions',
      args: { ...RANGE, granularity: 'quarterly', portfolioIds: [ID_1, ID_2] },
    });

    expect(investments).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      granularity: 'quarterly',
      portfolioIds: [ID_1, ID_2],
      decimals: DECIMALS,
    });
    expect(data.buckets[0]).toMatchObject({ total: 0.7, savingsNet: 2 });
  });
});

describe('get_venture_contributions', () => {
  it('returns each deal contribution as a decimal', async () => {
    ventures.mockResolvedValue([{ dealId: ID_1, name: 'Seed', amount: asMinorUnits(-4_200) }]);

    const { data } = await call({ name: 'get_venture_contributions', args: RANGE });

    expect(ventures).toHaveBeenCalledWith({ userId: 42, ...RANGE, decimals: DECIMALS });
    expect(data).toEqual([{ dealId: ID_1, name: 'Seed', amount: -4.2 }]);
  });
});

describe('get_pivot_report', () => {
  it('maps the input to the service with arrays and returns decimals', async () => {
    pivot.mockResolvedValue({
      columns: [{ key: '2026-01', label: 'Jan', periodStart: '2026-01-01', periodEnd: '2026-01-31' }],
      rows: [
        {
          id: ID_1,
          label: 'Food',
          color: '#fff',
          parentId: null,
          kind: 'category',
          values: { '2026-01': asMinorUnits(1_250) },
          total: asMinorUnits(1_250),
        },
      ],
      columnTotals: { '2026-01': asMinorUnits(1_250) },
      grandTotal: asMinorUnits(1_250),
      currencyCode: 'USD',
    } as never);

    const { data } = await call({
      name: 'get_pivot_report',
      args: {
        ...RANGE,
        granularity: 'monthly',
        rowDimension: 'category',
        measure: 'expense',
        accountIds: [ID_1],
        categoryIds: [ID_2],
        payeeIds: [ID_3],
      },
    });

    expect(pivot).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      accountIds: [ID_1],
      categoryIds: [ID_2],
      payeeIds: [ID_3],
      decimals: DECIMALS,
    });
    expect(data.grandTotal).toBe(1.25);
    expect(data.rows[0]).toMatchObject({ total: 1.25, values: { '2026-01': 1.25 } });
  });
});

const cumulativePeriod = (year: number) => ({
  year,
  data: [{ month: 0, monthLabel: 'Jan', value: asMinorUnits(2_000), periodValue: asMinorUnits(2_000) }],
  total: asMinorUnits(2_000),
});

describe('get_cumulative_stats', () => {
  it('passes every scope list through as an array and returns decimals', async () => {
    cumulative.mockResolvedValue({
      currentPeriod: cumulativePeriod(2026),
      previousPeriod: cumulativePeriod(2025),
      percentChange: 0,
    });

    const { data } = await call({
      name: 'get_cumulative_stats',
      args: {
        ...RANGE,
        metric: 'savings',
        accountId: ID_1,
        accountIds: [ID_2],
        payeeIds: [ID_1],
        excludedPayeeIds: [ID_2],
        tagIds: [ID_3],
        excludedTagIds: [ID_1],
        categoryIds: [ID_2],
        excludedCategoryIds: [ID_3],
      },
    });

    expect(cumulative).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      metric: 'savings',
      accountId: ID_1,
      accountIds: [ID_2],
      payeeIds: [ID_1],
      excludedPayeeIds: [ID_2],
      tagIds: [ID_3],
      excludedTagIds: [ID_1],
      categoryIds: [ID_2],
      excludedCategoryIds: [ID_3],
      decimals: DECIMALS,
    });
    expect(data.currentPeriod).toMatchObject({ total: 2, data: [{ value: 2, periodValue: 2 }] });
  });
});

describe('get_earliest_transaction_date', () => {
  it('returns the date, or null for a user without transactions', async () => {
    earliest.mockResolvedValueOnce('2024-05-17');
    expect((await call({ name: 'get_earliest_transaction_date' })).data).toBe('2024-05-17');

    earliest.mockResolvedValueOnce(null);
    expect((await call({ name: 'get_earliest_transaction_date' })).data).toBeNull();
    expect(earliest).toHaveBeenCalledWith({ userId: 42 });
  });
});

describe('existing stats tools through the report functions', () => {
  it('get_cash_flow passes decimals and returns decimals', async () => {
    cashFlow.mockResolvedValue({
      periods: [
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          income: asMinorUnits(3_000),
          expenses: asMinorUnits(1_200),
          netFlow: asMinorUnits(1_800),
        },
      ],
      totals: {
        income: asMinorUnits(3_000),
        expenses: asMinorUnits(1_200),
        netFlow: asMinorUnits(1_800),
        savingsRate: 60,
      },
    } as never);

    const { data } = await call({
      name: 'get_cash_flow',
      args: { startDate: '2026-01-01', endDate: '2026-01-31', accountId: ID_1, categoryIds: [ID_2] },
    });

    expect(cashFlow).toHaveBeenCalledWith({
      userId: 42,
      from: '2026-01-01',
      to: '2026-01-31',
      granularity: 'monthly',
      accountId: ID_1,
      categoryIds: [ID_2],
      decimals: DECIMALS,
    });
    expect(data.totals).toEqual({ income: 3, expenses: 1.2, netFlow: 1.8, savingsRate: 60 });
  });

  it('get_expenses_for_period passes decimals and returns the total as a decimal', async () => {
    expenses.mockResolvedValue(4_567);

    const { data } = await call({
      name: 'get_expenses_for_period',
      args: { startDate: '2026-01-01', endDate: '2026-01-31', excludedCategoryIds: [ID_1] },
    });

    expect(expenses).toHaveBeenCalledWith({
      userId: 42,
      from: '2026-01-01',
      to: '2026-01-31',
      excludedCategoryIds: [ID_1],
      decimals: DECIMALS,
    });
    expect(data.totalExpenses).toBe(4.567);
  });

  it('get_spending_by_categories passes decimals and sums the decimal amounts with Money', async () => {
    spendings.mockResolvedValue({
      [ID_1]: { name: 'Food', color: '#111', amount: 100 },
      [ID_2]: { name: 'Rent', color: '#222', amount: 200 },
    } as never);

    const { data } = await call({
      name: 'get_spending_by_categories',
      args: {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        transactionType: TRANSACTION_TYPES.expense,
        categoryIds: [ID_1, ID_2],
      },
    });

    expect(spendings).toHaveBeenCalledWith({
      userId: 42,
      from: '2026-01-01',
      to: '2026-01-31',
      transactionType: TRANSACTION_TYPES.expense,
      categoryIds: [ID_1, ID_2],
      decimals: DECIMALS,
    });
    expect(data.categories).toEqual([
      { id: ID_1, name: 'Food', color: '#111', amount: 0.1 },
      { id: ID_2, name: 'Rent', color: '#222', amount: 0.2 },
    ]);
    expect(data.total).toBe(0.3);
  });
});
