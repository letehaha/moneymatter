import {
  ALLOCATION_CASH_KEY,
  INVESTMENT_TRANSACTION_CATEGORY,
  PORTFOLIO_BENCHMARKS,
  PORTFOLIO_RETURN_PERIODS,
  type PortfolioAnalyticsHoldingModel,
  type PortfolioAnalyticsModel,
  type PortfolioBenchmark,
  type PortfolioBenchmarkSeriesModel,
  type PortfolioFeesPaidModel,
  type PortfolioReturnPeriod,
  SECURITY_TYPE,
} from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { logger } from '@js/utils';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import { getHoldingValues } from '@services/investments/holdings/get-holding-values.service';
import { buildPortfolioValueHistory } from '@services/investments/portfolios/get-portfolio-value-history.service';
import {
  buildPriceLookupWithPreWindowAnchors,
  loadDailySecurityPrices,
} from '@services/stats/get-combined-balance-history/security-price-anchors';
import { createFindPriceForDate } from '@services/stats/get-combined-balance-history/security-price-lookup';
import { Op } from 'sequelize';

import {
  type SeriesPoint,
  buildAllocation,
  buildReturnAnchors,
  computeMaxDrawdown,
  computeMoneyWeightedReturn,
  computeMonthlyMarketGain,
  toMoneyString,
  toRatioString,
} from './analytics-math';
import { resolveBenchmarkSecurity } from './resolve-benchmark-security';

type ValueHistory = Awaited<ReturnType<typeof buildPortfolioValueHistory>>;

const toSeries = ({ points }: ValueHistory): SeriesPoint[] =>
  points.map((point) => ({
    date: point.date,
    totalValue: Number(point.totalValue),
    netDeposits: Number(point.netDeposits),
    timeWeightedReturn: Number(point.timeWeightedReturn),
  }));

/** Points from `from` on (the last point when `from` is past it), with the TWR rebased to 0 on the first one. */
const sliceWindow = ({ points, from }: { points: SeriesPoint[]; from?: string }): SeriesPoint[] => {
  const startIndex = from ? points.findIndex((point) => point.date >= from) : 0;
  const window = startIndex === -1 ? points.slice(-1) : points.slice(startIndex);
  const startIndexValue = 1 + window[0]!.timeWeightedReturn;
  return window.map((point) => ({
    ...point,
    timeWeightedReturn: (1 + point.timeWeightedReturn) / startIndexValue - 1,
  }));
};

/** A holding with no stored price, or whose base rate failed, is carried at cost basis, as the value history does. */
const baseValueOf = ({ holding }: { holding: Awaited<ReturnType<typeof getHoldingValues>>[number] }) => {
  const isPriced =
    holding.latestPrice !== undefined && (Number(holding.marketValue) <= 0 || holding.baseRate !== undefined);
  return Number(isPriced ? holding.refMarketValue : holding.refCostBasis);
};

/** Fees and buys of the window's transactions, each converted at its own day's rate. */
const summarizeFees = async ({
  portfolioId,
  fromDate,
  toDate,
  toDisplayRate,
}: {
  portfolioId: string;
  fromDate: string;
  toDate: string;
  toDisplayRate: ValueHistory['toDisplayRate'];
}): Promise<PortfolioFeesPaidModel> => {
  const transactions = await InvestmentTransaction.findAll({
    where: {
      portfolioId,
      date: { [Op.between]: [new Date(`${fromDate}T00:00:00.000Z`), new Date(`${toDate}T23:59:59.999Z`)] },
    },
    attributes: ['category', 'date', 'refAmount', 'refFees'],
  });

  let fees = 0;
  let buys = 0;
  for (const tx of transactions) {
    const rate = toDisplayRate({ date: toUtcDateString(tx.date) });
    const amount = tx.refAmount.toNumber() * rate;
    // A fee row's charge is its amount, which already includes its own `fees`.
    fees += tx.category === INVESTMENT_TRANSACTION_CATEGORY.fee ? amount : tx.refFees.toNumber() * rate;

    if (tx.category === INVESTMENT_TRANSACTION_CATEGORY.buy) buys += amount;
  }

  return {
    amount: toMoneyString({ amount: fees }),
    shareOfBuys: buys > 0 ? toRatioString({ ratio: fees / buys }) : null,
  };
};

/**
 * The benchmark's close in the analytics currency on each window date, rebased onto the portfolio's
 * return on the first date it has a close. Empty without prices or without a rate for its currency.
 */
const buildBenchmarkSeries = async ({
  benchmark,
  series,
  foreignToDisplayRate,
}: {
  benchmark: PortfolioBenchmark;
  series: SeriesPoint[];
  foreignToDisplayRate: ValueHistory['foreignToDisplayRate'];
}): Promise<PortfolioBenchmarkSeriesModel['series']> => {
  const security = await resolveBenchmarkSecurity({ benchmark });
  const fromDate = series[0]!.date;
  const windowPrices = await loadDailySecurityPrices({
    securityIds: [security.id],
    fromDate,
    toDate: series.at(-1)!.date,
  });
  const findPrice = createFindPriceForDate(
    await buildPriceLookupWithPreWindowAnchors({ windowPrices, securityIds: [security.id], windowStart: fromDate }),
  );

  const values: { date: string; value: number; portfolioReturn: number }[] = [];
  for (const { date, timeWeightedReturn } of series) {
    const close = findPrice(security.id, date);
    if (close === null) continue;
    const rate = foreignToDisplayRate({ currencyCode: security.currencyCode, date });
    if (rate === null) {
      logger.warn('Benchmark series dropped: no exchange rate for its currency', {
        code: 'BENCHMARK_RATE_MISSING',
        benchmark,
        securityId: security.id,
        securityCurrencyCode: security.currencyCode,
        benchmarkCurrencyCode: PORTFOLIO_BENCHMARKS[benchmark].currencyCode,
      });
      return [];
    }
    values.push({ date, value: close * rate, portfolioReturn: timeWeightedReturn });
  }

  const start = values[0];
  if (!start) return [];
  return values.map(({ date, value }) => ({
    date,
    value: toRatioString({ ratio: (1 + start.portfolioReturn) * (value / start.value) - 1 }),
  }));
};

/**
 * Value, deposits and TWR come from the value history for the period; holdings, cash and
 * allocation are current. Money is in the value history's currency.
 */
export const getPortfolioAnalytics = async ({
  userId,
  portfolioId,
  from,
  to,
  benchmark,
}: {
  userId: number;
  portfolioId: string;
  from?: string;
  to?: string;
  benchmark?: PortfolioBenchmark;
}): Promise<PortfolioAnalyticsModel> => {
  const history = await buildPortfolioValueHistory({
    userId,
    portfolioId,
    to,
    extraCurrencyCodes: benchmark ? [PORTFOLIO_BENCHMARKS[benchmark].currencyCode] : [],
  });
  const [holdingValues, balances] = await Promise.all([
    getHoldingValues({ portfolioId, userId }),
    PortfolioBalances.findAll({ where: { portfolioId } }),
  ]);

  const fullSeries = toSeries(history);
  const series = sliceWindow({ points: fullSeries, from });
  const endDate = series.at(-1)!.date;
  const baseToDisplay = history.toDisplayRate({ date: endDate });
  const holdings = holdingValues
    .filter((holding) => Number(holding.quantity) > 0)
    .map((holding) => ({ ...holding, value: baseValueOf({ holding }) * baseToDisplay }))
    .toSorted((a, b) => b.value - a.value);
  const cash = balances
    .map((balance) => ({ currencyCode: balance.currencyCode, value: balance.refTotalCash.toNumber() * baseToDisplay }))
    .filter((balance) => Math.abs(balance.value) >= 0.005);

  const isEmpty =
    holdings.length === 0 && cash.length === 0 && series.every((point) => !point.totalValue && !point.netDeposits);
  if (isEmpty) {
    return {
      currencyCode: history.currencyCode,
      kpis: {
        moneyWeightedReturn: null,
        timeWeightedReturn: toRatioString({ ratio: 0 }),
        maxDrawdown: null,
        feesPaid: { amount: toMoneyString({ amount: 0 }), shareOfBuys: null },
      },
      monthlyMarketGain: [],
      holdings: [],
      portfolioReturnSeries: [],
      allocation: { byHolding: [], bySecurityType: [], byCurrency: [] },
      ...(benchmark && { benchmark: { key: benchmark, series: [] } }),
    };
  }

  const [feesPaid, benchmarkSeries] = await Promise.all([
    summarizeFees({
      portfolioId,
      fromDate: series[0]!.date,
      toDate: endDate,
      toDisplayRate: history.toDisplayRate,
    }),
    benchmark && buildBenchmarkSeries({ benchmark, series, foreignToDisplayRate: history.foreignToDisplayRate }),
  ]);

  const anchors = buildReturnAnchors({ endDate });
  const securityIds = holdings.map((holding) => holding.securityId);
  const priceWindowStart = Object.values(anchors).toSorted()[0]!;
  const windowPrices = await loadDailySecurityPrices({ securityIds, fromDate: priceWindowStart, toDate: endDate });
  const priceLookup = await buildPriceLookupWithPreWindowAnchors({
    windowPrices,
    securityIds,
    windowStart: priceWindowStart,
  });
  const findPrice = createFindPriceForDate(priceLookup);

  // A buy recorded without a deposit leaves negative cash, which would push weights past 1.
  const totalCash = Math.max(
    cash.reduce((sum, balance) => sum + balance.value, 0),
    0,
  );
  const totalValue = holdings.reduce((sum, holding) => sum + holding.value, 0) + totalCash;
  const cashEntries = totalCash ? [{ key: ALLOCATION_CASH_KEY, label: null, value: totalCash }] : [];

  const holdingModels: PortfolioAnalyticsHoldingModel[] = holdings.map((holding) => {
    const latestPrice = findPrice(holding.securityId, endDate);
    const latestPriceDate = priceLookup.pricesBySecurity.get(holding.securityId)?.at(-1)?.date;
    const returns = Object.fromEntries(
      PORTFOLIO_RETURN_PERIODS.map((period) => {
        const anchorPrice = findPrice(holding.securityId, anchors[period]);
        // A last close before the anchor means the price stopped syncing, not a flat period.
        const isStale = !latestPriceDate || latestPriceDate < anchors[period];
        return [
          period,
          latestPrice !== null && anchorPrice && !isStale
            ? toRatioString({ ratio: latestPrice / anchorPrice - 1 })
            : null,
        ];
      }),
    ) as Record<PortfolioReturnPeriod, string | null>;

    return {
      securityId: holding.securityId,
      symbol: holding.security?.symbol ?? null,
      name: holding.security?.name ?? null,
      currencyCode: holding.currencyCode,
      value: toMoneyString({ amount: holding.value }),
      weight: toRatioString({ ratio: totalValue > 0 ? holding.value / totalValue : 0 }),
      returns,
    };
  });

  return {
    currencyCode: history.currencyCode,
    kpis: {
      moneyWeightedReturn: computeMoneyWeightedReturn({ points: fullSeries }),
      timeWeightedReturn: toRatioString({ ratio: series.at(-1)!.timeWeightedReturn }),
      maxDrawdown: computeMaxDrawdown({ points: series }),
      feesPaid,
    },
    monthlyMarketGain: computeMonthlyMarketGain({ points: series }),
    holdings: holdingModels,
    portfolioReturnSeries: series.map(({ date, timeWeightedReturn }) => ({
      date,
      value: toRatioString({ ratio: timeWeightedReturn }),
    })),
    allocation: {
      byHolding: buildAllocation({
        entries: [
          ...holdings.map((holding) => ({
            key: holding.securityId,
            label: holding.security?.symbol ?? null,
            value: holding.value,
          })),
          ...cashEntries,
        ],
        total: totalValue,
      }),
      bySecurityType: buildAllocation<SECURITY_TYPE | typeof ALLOCATION_CASH_KEY>({
        entries: [
          ...holdings.map((holding) => ({
            key: holding.security?.securityType ?? SECURITY_TYPE.other,
            label: null,
            value: holding.value,
          })),
          ...cashEntries,
        ],
        total: totalValue,
      }),
      byCurrency: buildAllocation({
        entries: [
          ...holdings.map((holding) => ({ key: holding.currencyCode, label: null, value: holding.value })),
          ...(totalCash ? cash : []).map((balance) => ({
            key: balance.currencyCode,
            label: null,
            value: balance.value,
          })),
        ],
        total: totalValue,
      }),
    },
    ...(benchmark && benchmarkSeries && { benchmark: { key: benchmark, series: benchmarkSeries } }),
  };
};
