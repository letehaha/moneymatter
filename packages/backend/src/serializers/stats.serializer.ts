/**
 * Stats Serializers
 *
 * Serializes stats data for API responses.
 * Report amounts arrive as integer minor units at the base currency's decimals; the serializers
 * that take `decimals` convert them with `minorUnitsToApiDecimal`.
 */
import type {
  CumulativePeriodData,
  EntityLogoFields,
  GetCashFlowResponse,
  GetCumulativeResponse,
  GetInvestmentContributionsResponse,
  GetNetWorthDriversResponse,
  GetNetWorthHistoryResponse,
  GetPivotReportResponse,
  GetSpendingsByCategoriesByTypeReturnType,
  GetSpendingsByCategoriesReturnType,
  GetVentureContributionsResponse,
} from '@bt/shared/types';
import { centsToApiDecimal, minorUnitsToApiDecimal, moneyToApiDecimal } from '@common/types/money';
import type Balances from '@models/balances.model';
import type { CombinedBalanceHistoryItem } from '@services/stats/get-combined-balance-history';
import type { InvestmentContributionsResultCents } from '@services/stats/get-investment-contributions';
import type { NetWorthDriversResultCents } from '@services/stats/get-net-worth-drivers';
import type { NetWorthHistoryResultCents } from '@services/stats/get-net-worth-history';
import type { PivotReportResultMinor } from '@services/stats/get-pivot';
import type { VentureContributionCents } from '@services/stats/get-venture-contributions';

import { serializeLogoFields } from './logo-fields.serializer';

// ============================================================================
// Balance History Serializers
// ============================================================================

interface BalanceHistoryItemApiResponse {
  date: Date | string;
  amount: number;
  accountId: string;
}

/**
 * Serialize balance history items (from getBalanceHistory). Each amount is a `Money`, so no scale
 * is needed.
 */
export function serializeBalanceHistory(balances: Balances[]): BalanceHistoryItemApiResponse[] {
  return balances.map((balance) => ({
    date: balance.date,
    amount: moneyToApiDecimal(balance.amount),
    accountId: balance.accountId,
  }));
}

// ============================================================================
// Total Balance Serializer
// ============================================================================

/**
 * Serialize total balance (from getTotalBalance)
 */
export function serializeTotalBalance({ totalMinor, decimals }: { totalMinor: number; decimals: number }): number {
  return minorUnitsToApiDecimal({ value: totalMinor, decimals });
}

// ============================================================================
// Spendings by Categories Serializers
// ============================================================================

interface SpendingStructureApiResponse {
  name: string;
  color: string;
  amount: number;
}

type GetSpendingsByCategoriesApiResponse = {
  [categoryId: string]: SpendingStructureApiResponse;
};

/**
 * Serialize spendings by categories (from getSpendingsByCategories)
 */
export function serializeSpendingsByCategories({
  spendings,
  decimals,
}: {
  spendings: GetSpendingsByCategoriesReturnType;
  decimals: number;
}): GetSpendingsByCategoriesApiResponse {
  const result: GetSpendingsByCategoriesApiResponse = {};

  for (const [categoryId, spending] of Object.entries(spendings)) {
    result[categoryId] = {
      name: spending.name,
      color: spending.color,
      amount: minorUnitsToApiDecimal({ value: spending.amount, decimals }),
    };
  }

  return result;
}

interface SpendingStructureByTypeApiResponse {
  name: string;
  color: string;
  income: number;
  expense: number;
}

type GetSpendingsByCategoriesByTypeApiResponse = {
  [categoryId: string]: SpendingStructureByTypeApiResponse;
};

/**
 * Serialize per-type spendings by categories (from getSpendingsByCategoriesByType)
 */
export function serializeSpendingsByCategoriesByType({
  spendings,
  decimals,
}: {
  spendings: GetSpendingsByCategoriesByTypeReturnType;
  decimals: number;
}): GetSpendingsByCategoriesByTypeApiResponse {
  const result: GetSpendingsByCategoriesByTypeApiResponse = {};

  for (const [categoryId, spending] of Object.entries(spendings)) {
    result[categoryId] = {
      name: spending.name,
      color: spending.color,
      income: minorUnitsToApiDecimal({ value: spending.income, decimals }),
      expense: minorUnitsToApiDecimal({ value: spending.expense, decimals }),
    };
  }

  return result;
}

// ============================================================================
// Cash Flow Serializers
// ============================================================================

interface CashFlowCategoryDataApiResponse {
  categoryId: string;
  name: string;
  color: string;
  incomeAmount: number;
  expenseAmount: number;
}

interface CashFlowPeriodDataApiResponse {
  periodStart: string;
  periodEnd: string;
  income: number;
  expenses: number;
  netFlow: number;
  categories?: CashFlowCategoryDataApiResponse[];
}

interface GetCashFlowApiResponse {
  periods: CashFlowPeriodDataApiResponse[];
  totals: {
    income: number;
    expenses: number;
    netFlow: number;
    savingsRate: number;
  };
}

/**
 * Serialize cash flow response (from getCashFlow)
 */
export function serializeCashFlow({
  cashFlow,
  decimals,
}: {
  cashFlow: GetCashFlowResponse;
  decimals: number;
}): GetCashFlowApiResponse {
  const toDecimal = (value: number) => minorUnitsToApiDecimal({ value, decimals });

  return {
    periods: cashFlow.periods.map((period) => ({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      income: toDecimal(period.income),
      expenses: toDecimal(period.expenses),
      netFlow: toDecimal(period.netFlow),
      categories: period.categories?.map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        color: category.color,
        incomeAmount: toDecimal(category.incomeAmount),
        expenseAmount: toDecimal(category.expenseAmount),
      })),
    })),
    totals: {
      income: toDecimal(cashFlow.totals.income),
      expenses: toDecimal(cashFlow.totals.expenses),
      netFlow: toDecimal(cashFlow.totals.netFlow),
      savingsRate: cashFlow.totals.savingsRate,
    },
  };
}

// ============================================================================
// Pivot Report Serializer
// ============================================================================

// Convert every cents amount in a keyed record to an API decimal, preserving the
// key type — a closed-kind record (assets/liabilities) whose exact keys are kept intact.
const decimalizeValues = <K extends string>(values: Record<K, number>): Record<K, number> => {
  const result = {} as Record<K, number>;
  for (const key of Object.keys(values) as K[]) {
    result[key] = centsToApiDecimal(values[key]);
  }
  return result;
};

// Convert every minor-units amount in a keyed record to an API decimal, preserving the key type.
const decimalizeMinorValues = <K extends string>({
  values,
  decimals,
}: {
  values: Record<K, number>;
  decimals: number;
}): Record<K, number> => {
  const result = {} as Record<K, number>;
  for (const key of Object.keys(values) as K[]) {
    result[key] = minorUnitsToApiDecimal({ value: values[key], decimals });
  }
  return result;
};

/**
 * Serialize pivot report (from getPivotReport). Converts every minor-units amount to an API decimal;
 * row/column identity, labels, colors and currency pass through unchanged.
 */
export function serializePivotReport({
  result,
  decimals,
}: {
  result: PivotReportResultMinor;
  decimals: number;
}): GetPivotReportResponse {
  return {
    columns: result.columns,
    rows: result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      color: row.color,
      // Only the payee dimension sets the logo fields; keep them off every other dimension's rows.
      ...(row.logoDomain !== undefined ? serializeLogoFields({ entity: row as EntityLogoFields }) : {}),
      parentId: row.parentId,
      kind: row.kind,
      values: decimalizeMinorValues({ values: row.values, decimals }),
      total: minorUnitsToApiDecimal({ value: row.total, decimals }),
    })),
    columnTotals: decimalizeMinorValues({ values: result.columnTotals, decimals }),
    grandTotal: minorUnitsToApiDecimal({ value: result.grandTotal, decimals }),
    currencyCode: result.currencyCode,
  };
}

// ============================================================================
// Cumulative Data Serializers
// ============================================================================

interface CumulativeMonthDataApiResponse {
  month: number;
  monthLabel: string;
  value: number;
  periodValue: number;
}

interface CumulativePeriodDataApiResponse {
  year: number;
  data: CumulativeMonthDataApiResponse[];
  total: number;
}

interface GetCumulativeApiResponse {
  currentPeriod: CumulativePeriodDataApiResponse;
  previousPeriod: CumulativePeriodDataApiResponse;
  percentChange: number;
}

/**
 * Serialize cumulative period data
 */
function serializeCumulativePeriod({
  period,
  decimals,
}: {
  period: CumulativePeriodData;
  decimals: number;
}): CumulativePeriodDataApiResponse {
  return {
    year: period.year,
    data: period.data.map((monthData) => ({
      month: monthData.month,
      monthLabel: monthData.monthLabel,
      value: minorUnitsToApiDecimal({ value: monthData.value, decimals }),
      periodValue: minorUnitsToApiDecimal({ value: monthData.periodValue, decimals }),
    })),
    total: minorUnitsToApiDecimal({ value: period.total, decimals }),
  };
}

/**
 * Serialize cumulative response (from getCumulativeData)
 */
export function serializeCumulativeData({
  cumulative,
  decimals,
}: {
  cumulative: GetCumulativeResponse;
  decimals: number;
}): GetCumulativeApiResponse {
  return {
    currentPeriod: serializeCumulativePeriod({ period: cumulative.currentPeriod, decimals }),
    previousPeriod: serializeCumulativePeriod({ period: cumulative.previousPeriod, decimals }),
    percentChange: cumulative.percentChange,
  };
}

// ============================================================================
// Combined Balance History Serializers
// ============================================================================

interface CombinedBalanceHistoryItemApiResponse {
  date: string;
  accountsBalance: number;
  portfoliosBalance: number;
  venturesBalance: number;
  vehiclesBalance: number;
  loansBalance: number;
  totalBalance: number;
}

/**
 * Serialize combined balance history (from getCombinedBalanceHistory)
 */
export function serializeCombinedBalanceHistory(
  items: CombinedBalanceHistoryItem[],
): CombinedBalanceHistoryItemApiResponse[] {
  return items.map((item) => ({
    date: item.date,
    accountsBalance: centsToApiDecimal(item.accountsBalance),
    portfoliosBalance: centsToApiDecimal(item.portfoliosBalance),
    venturesBalance: centsToApiDecimal(item.venturesBalance),
    vehiclesBalance: centsToApiDecimal(item.vehiclesBalance),
    loansBalance: centsToApiDecimal(item.loansBalance),
    totalBalance: centsToApiDecimal(item.totalBalance),
  }));
}

// ============================================================================
// Expenses Amount for Period Serializer
// ============================================================================

/**
 * Serialize expenses amount for period (from getExpensesAmountForPeriod)
 */
export function serializeExpensesAmountForPeriod({
  amountMinor,
  decimals,
}: {
  amountMinor: number;
  decimals: number;
}): number {
  return minorUnitsToApiDecimal({ value: amountMinor, decimals });
}

// ============================================================================
// Net Worth Drivers Serializer
// ============================================================================

/**
 * Serialize net worth drivers (from getNetWorthDrivers). Every amount is money, so
 * every amount is decimalized — each `byPortfolio.growth` included; the period bounds
 * pass through as dates, the `portfolios` legend (ids and names, no money) and
 * `degraded` (securities and currency codes, no money) forward untouched.
 */
export function serializeNetWorthDrivers(result: NetWorthDriversResultCents): GetNetWorthDriversResponse {
  return {
    buckets: result.buckets.map((bucket) => ({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      savings: {
        income: centsToApiDecimal(bucket.savings.income),
        expenses: centsToApiDecimal(bucket.savings.expenses),
        net: centsToApiDecimal(bucket.savings.net),
      },
      investments: {
        growth: centsToApiDecimal(bucket.investments.growth),
        priceEffect: centsToApiDecimal(bucket.investments.priceEffect),
        dividends: centsToApiDecimal(bucket.investments.dividends),
        feesAndTaxes: centsToApiDecimal(bucket.investments.feesAndTaxes),
        byPortfolio: bucket.investments.byPortfolio.map((slice) => ({
          portfolioId: slice.portfolioId,
          growth: centsToApiDecimal(slice.growth),
        })),
      },
      composition: {
        holdingsValue: centsToApiDecimal(bucket.composition.holdingsValue),
        cashValue: centsToApiDecimal(bucket.composition.cashValue),
      },
    })),
    portfolios: result.portfolios,
    // Kept off the response entirely when the service reports nothing degraded: the
    // contract lets a client decide on `degraded` alone whether to warn, and a
    // present-but-empty key would trip that check on a cleanly valued range.
    ...(result.degraded ? { degraded: result.degraded } : {}),
  };
}

// ============================================================================
// Net Worth History Serializer
// ============================================================================

/**
 * Serialize net worth history (from getNetWorthHistory). Every amount is money, so
 * every amount is decimalized; the snapshot dates pass through unchanged, and
 * `degraded` (securities and currency codes, no money) forwards untouched.
 */
export function serializeNetWorthHistory(result: NetWorthHistoryResultCents): GetNetWorthHistoryResponse {
  return {
    points: result.points.map((point) => ({
      date: point.date,
      assets: decimalizeValues(point.assets),
      assetsTotal: centsToApiDecimal(point.assetsTotal),
      liabilities: decimalizeValues(point.liabilities),
      liabilitiesTotal: centsToApiDecimal(point.liabilitiesTotal),
      netWorth: centsToApiDecimal(point.netWorth),
    })),
    // Kept off the response entirely when the service reports nothing degraded: the
    // contract lets a client decide on `degraded` alone whether to warn, and a
    // present-but-empty key would trip that check on a cleanly valued range.
    ...(result.degraded ? { degraded: result.degraded } : {}),
  };
}

// ============================================================================
// Investment Contributions Serializer
// ============================================================================

/**
 * Serialize investment contributions (from getInvestmentContributions). Every
 * bucket amount is money, so `total`, `savingsNet` and each `byPortfolio.amount`
 * are decimalized; period bounds pass through as dates and the `portfolios` legend
 * (ids and names, no money) forwards untouched.
 */
export function serializeInvestmentContributions(
  result: InvestmentContributionsResultCents,
): GetInvestmentContributionsResponse {
  return {
    buckets: result.buckets.map((bucket) => ({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      total: centsToApiDecimal(bucket.total),
      byPortfolio: bucket.byPortfolio.map((slice) => ({
        portfolioId: slice.portfolioId,
        amount: centsToApiDecimal(slice.amount),
      })),
      savingsNet: centsToApiDecimal(bucket.savingsNet),
    })),
    portfolios: result.portfolios,
  };
}

export function serializeVentureContributions(result: VentureContributionCents[]): GetVentureContributionsResponse {
  return result.map((deal) => ({ dealId: deal.dealId, name: deal.name, amount: centsToApiDecimal(deal.amount) }));
}
