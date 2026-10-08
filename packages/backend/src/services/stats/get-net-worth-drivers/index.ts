import {
  ACCOUNT_CATEGORIES,
  type Cents,
  type NetWorthDriversDegraded,
  type NetWorthDriversGranularity,
  type NetWorthDriversPortfolioMeta,
  type NetWorthDriversUnpricedSecurity,
  type RecordId,
  asCents,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError } from '@js/errors';
import { logger } from '@js/utils';
import ExchangeRates from '@models/exchange-rates.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import { getAggregatedBalanceHistory } from '@services/stats/get-balance-history';
import { fetchSavingsTransactions, generatePeriodBuckets, getScopedEnabledPortfolios } from '@services/stats/utils';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

// The holdings/cash replays and their price + FX lookups are shared with
// `get-combined-balance-history`, deliberately: this report's investment values
// must agree with the net-worth chart the user reads them next to, and forking
// the replay would let the two drift apart on every future fix.
import {
  buildUserRatesMap,
  createFindLatestUsdRate,
  createGetExchangeRate,
} from '../get-combined-balance-history/exchange-rate-lookup';
import { computeHoldingsValueByDate } from '../get-combined-balance-history/holdings-replay';
import {
  accumulateCashDeltas,
  computePortfolioCashByDate,
} from '../get-combined-balance-history/portfolio-cash-replay';
import { buildPriceLookupWithPreWindowAnchors } from '../get-combined-balance-history/security-price-anchors';
import { createFindPriceForDate } from '../get-combined-balance-history/security-price-lookup';
import type { CurrentBalanceRow, SecurityRow, TransferRow } from '../get-combined-balance-history/types';
import { buildBoundaryDates, buildDenseDateRange } from './date-range';
import {
  type InvestmentGrowthCents,
  type PortfolioGrowthSeries,
  accumulateInvestmentFlows,
  computeInvestmentGrowth,
  foldPortfolioGrowth,
} from './investment-growth';
import { accumulateSavings } from './savings';
import type { NetWorthDriversPortfolioSliceCents, NetWorthDriversResultCents, ReportTransactionRow } from './types';

export type { NetWorthDriversResultCents } from './types';

interface GetNetWorthDriversParams {
  userId: number;
  from: string;
  to: string;
  granularity: NetWorthDriversGranularity;
  /**
   * Optional subset of the user's enabled portfolios to scope the investment slice
   * to (holdings, portfolio cash, flows, growth, and the unpriced-securities
   * warning). Empty or absent includes every enabled portfolio. Savings and
   * account-level cash are user-wide and stay unaffected by this filter.
   */
  portfolioIds?: RecordId[];
}

interface InvestmentSlice {
  /**
   * Holdings market value in cents, keyed by the snapshot days only. Summed from the
   * per-portfolio cents so it agrees with the per-portfolio growth split exactly.
   */
  holdingsCentsByDate: Map<string, Cents>;
  /** Uninvested portfolio cash in cents, keyed by every day in the window. */
  cashCentsByDate: Map<string, Cents>;
  /** Per-bucket growth totals: the elementwise sum of every in-scope portfolio's series. */
  growth: InvestmentGrowthCents[];
  /** Sparse per-portfolio split of each bucket's growth, positionally aligned with the buckets. */
  growthByPortfolio: NetWorthDriversPortfolioSliceCents[][];
  /** Portfolios active anywhere in the window, largest absolute total growth first. */
  portfolios: NetWorthDriversPortfolioMeta[];
  /**
   * Holdings the replay had no price for and therefore carried at cost basis, so
   * their price movement is understated. Empty when every holding priced.
   */
  unpricedSecurities: NetWorthDriversUnpricedSecurity[];
  /**
   * Currencies converted without a real rate for the day: at the currency's earliest
   * stored rate for earlier dates, or 1:1 when none is stored. Empty when all resolved.
   */
  fxFallbackCurrencies: string[];
}

/**
 * Slice for a user with nothing invested. `growth` still carries one zeroed entry
 * per bucket rather than being empty — every bucket must line up with a growth
 * entry positionally, and a user with no portfolios still gets a full row of
 * buckets showing their savings.
 */
const buildEmptySlice = ({ boundaryDates }: { boundaryDates: string[] }): InvestmentSlice => {
  const { totals, byBucket, legend } = foldPortfolioGrowth({
    series: [],
    bucketCount: Math.max(boundaryDates.length - 1, 0),
  });

  return {
    holdingsCentsByDate: new Map(),
    cashCentsByDate: new Map(),
    growth: totals,
    growthByPortfolio: byBucket,
    portfolios: legend,
    unpricedSecurities: [],
    fxFallbackCurrencies: [],
  };
};

/**
 * Assemble the `degraded` payload from the two independent data-quality failures,
 * or `undefined` when neither fired. The wire contract forbids an empty object:
 * a truthiness check on `degraded` alone decides whether the client renders a
 * warning, so each inner field is set only when non-empty and the whole object is
 * dropped when both are.
 */
const buildDegraded = ({
  unpricedSecurities,
  fxFallbackCurrencies,
}: {
  unpricedSecurities: NetWorthDriversUnpricedSecurity[];
  fxFallbackCurrencies: string[];
}): NetWorthDriversDegraded | undefined => {
  const degraded: NetWorthDriversDegraded = {};
  if (unpricedSecurities.length > 0) degraded.unpricedSecurities = unpricedSecurities;
  if (fxFallbackCurrencies.length > 0) degraded.fxFallbackCurrencies = fxFallbackCurrencies;

  return degraded.unpricedSecurities || degraded.fxFallbackCurrencies ? degraded : undefined;
};

/**
 * Investment slice: holdings value on each snapshot day, uninvested portfolio
 * cash on every day, and the per-bucket growth that separates market movement from
 * money the user put in — derived one portfolio at a time and summed.
 */
const calculateInvestmentSlice = async ({
  userId,
  boundaryDates,
  denseDates,
  userBaseCurrencyPromise,
  portfolioIdsFilter,
}: {
  userId: number;
  boundaryDates: string[];
  denseDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
  /**
   * When non-empty, restricts the slice to these portfolios. The restriction is
   * applied as an `id IN (...)` on top of the owned-and-enabled filter, so the DB
   * intersects the request against what the user actually owns — a foreign or
   * disabled id never leaks through. Empty or absent includes every enabled one.
   */
  portfolioIdsFilter?: RecordId[];
}): Promise<InvestmentSlice> => {
  const minDate = boundaryDates[0]!;
  const maxDate = boundaryDates[boundaryDates.length - 1]!;

  const [userBaseCurrency, portfolios] = await Promise.all([
    userBaseCurrencyPromise,
    // Disabled portfolios are excluded from the net-worth chart, so scoping to the
    // enabled set here keeps this report reconcilable with it.
    getScopedEnabledPortfolios({ userId, portfolioIds: portfolioIdsFilter }),
  ]);

  // No portfolios is a legitimate empty state: the user simply has nothing
  // invested, so an empty investment slice against a full row of savings buckets
  // is the truthful report.
  if (portfolios.length === 0) {
    return buildEmptySlice({ boundaryDates });
  }

  // Portfolios but no default currency is a data anomaly, not an empty state:
  // every holding value and every foreign cash leg is converted through the base
  // currency, so with none set the whole investment side is unvaluable. Returning
  // an empty slice here would render as a confident "you have no investments"
  // over holdings the user actually owns — fail loudly instead so it surfaces.
  // The `degraded` contract has no field to express a missing valuation basis, so
  // it cannot carry this; a hard stop is the only honest signal.
  if (!userBaseCurrency?.currencyCode) {
    logger.error('Net-worth drivers: user has enabled portfolios but no default currency set', {
      userId,
      portfolioCount: portfolios.length,
    });
    throw new UnexpectedError({
      message: 'Cannot value investments for the net-worth drivers report: no default currency is set.',
    });
  }

  const portfolioIds = portfolios.map((portfolio) => portfolio.id);

  // Cash rows must reach through end-of-TODAY even when the window ends earlier:
  // `computePortfolioCashByDate` anchors on stored cash and back-subtracts every
  // delta through today (see its doc), so a narrower fetch offsets every day.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const cashFetchMaxDate = maxDate > todayKey ? maxDate : todayKey;

  const [transactions, portfolioTransfers, currentBalances]: [
    ReportTransactionRow[],
    TransferRow[],
    CurrentBalanceRow[],
  ] = await Promise.all([
    // `raw: true` + narrow attributes on purpose: the full trade history loads
    // here (pre-window rows seed opening holdings and cash), and hydrating a
    // Money object per money column per row is enough to OOM under concurrent
    // dashboard requests. DECIMALs arrive as strings (see `ReportTransactionRow`).
    InvestmentTransaction.findAll({
      where: {
        portfolioId: { [Op.in]: portfolioIds },
        // `date` is TIMESTAMPTZ; end-of-day bound keeps the final day's intraday trades.
        date: { [Op.lte]: `${cashFetchMaxDate}T23:59:59.999Z` },
      },
      // The holdings replay folds a forward-only cursor per portfolio and
      // breaks at the first transaction past the snapshot day — it reads wrong
      // unless each portfolio's rows arrive ascending by date.
      order: [
        ['portfolioId', 'ASC'],
        ['date', 'ASC'],
        ['createdAt', 'ASC'],
      ],
      attributes: [
        'portfolioId',
        'securityId',
        'category',
        'date',
        'quantity',
        'refAmount',
        'refFees',
        'currencyCode',
        'settlementAmount',
        'settlementCurrencyCode',
      ],
      raw: true,
    }) as unknown as Promise<ReportTransactionRow[]>,
    PortfolioTransfers.findAll({
      where: {
        userId,
        affectsCash: true,
        date: { [Op.lte]: cashFetchMaxDate },
        [Op.or]: [{ fromPortfolioId: { [Op.in]: portfolioIds } }, { toPortfolioId: { [Op.in]: portfolioIds } }],
      },
      attributes: ['fromPortfolioId', 'toPortfolioId', 'amount', 'currencyCode', 'toCurrencyCode', 'toAmount', 'date'],
    }),
    PortfolioBalances.findAll({
      where: { portfolioId: { [Op.in]: portfolioIds } },
      attributes: ['portfolioId', 'currencyCode', 'totalCash', 'refTotalCash'],
    }),
  ]);

  if (transactions.length === 0 && portfolioTransfers.length === 0 && currentBalances.length === 0) {
    return buildEmptySlice({ boundaryDates });
  }

  const securityIds = [...new Set(transactions.map((tx) => tx.securityId))];

  // Prices are quoted in the security's own currency, which is not necessarily
  // the transaction's cash-leg currency (a USD-settled ASML.AS buy, say). `symbol`
  // and `name` are carried only to label any holding the report can't price when
  // building the `degraded` warning — the replay itself reads neither.
  type SecurityWithLabel = SecurityRow & Pick<Securities, 'symbol' | 'name'>;
  const securities = (await Securities.findAll({
    where: { id: { [Op.in]: securityIds } },
    attributes: ['id', 'currencyCode', 'assetClass', 'symbol', 'name'],
    raw: true,
  })) as SecurityWithLabel[];
  const securitiesById = new Map<string, SecurityRow>(securities.map((security) => [security.id, security]));
  const securityLabelById = new Map<string, { symbol: string | null; name: string | null }>(
    securities.map((security) => [security.id, { symbol: security.symbol, name: security.name }]),
  );

  // Any currency missing from this list silently converts 1:1, so it collects
  // security currencies plus every cash-leg currency, including balances that a
  // direct write seeded with no transaction or transfer behind them.
  const cashCurrencyCodes: string[] = [];
  for (const tx of transactions) cashCurrencyCodes.push(tx.settlementCurrencyCode);
  for (const transfer of portfolioTransfers) {
    cashCurrencyCodes.push(transfer.currencyCode);
    if (transfer.toCurrencyCode) cashCurrencyCodes.push(transfer.toCurrencyCode);
  }
  for (const balance of currentBalances) cashCurrencyCodes.push(balance.currencyCode);
  const currencyCodes = [...new Set([...securities.map((security) => security.currencyCode), ...cashCurrencyCodes])];

  // Reach back a week so a snapshot landing on a weekend or holiday still finds
  // the prior trading day's price and rate.
  const dataFetchMinDate = format(subDays(parseISO(minDate), 7), 'yyyy-MM-dd');

  const usdRateQuoteCodes = [...new Set([userBaseCurrency.currencyCode, ...currencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  const [securityPrices, userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    SecurityPricing.findAll({
      where: {
        securityId: { [Op.in]: securityIds },
        date: { [Op.between]: [startOfDay(parseISO(dataFetchMinDate)), endOfDay(parseISO(maxDate))] },
      },
      order: [
        ['securityId', 'ASC'],
        ['date', 'ASC'],
      ],
      attributes: ['securityId', 'date', 'priceClose'],
      raw: true,
    }),
    UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: { [Op.in]: currencyCodes },
        quoteCode: userBaseCurrency.currencyCode,
        date: { [Op.between]: [dataFetchMinDate, maxDate] },
      },
      attributes: ['baseCode', 'quoteCode', 'date', 'rate'],
      raw: true,
    }),
    ExchangeRates.findAll({
      where: {
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: { [Op.in]: usdRateQuoteCodes },
        date: { [Op.between]: [startOfDay(parseISO(dataFetchMinDate)), endOfDay(parseISO(maxDate))] },
      },
      order: [
        ['quoteCode', 'ASC'],
        ['date', 'ASC'],
      ],
      raw: true,
    }),
  ]);

  // Seed the lookup with one pre-window anchor per security so a holding whose
  // last stored price predates the fetched window still values at that price
  // instead of collapsing to cost basis and fabricating a price move.
  const findPriceForDate = createFindPriceForDate(
    await buildPriceLookupWithPreWindowAnchors({
      windowPrices: securityPrices,
      securityIds,
      windowStart: dataFetchMinDate,
    }),
  );
  const userRatesMap = buildUserRatesMap(userCustomExchangeRates);

  const { usdRatesMap, usdRateDatesByQuote } = await buildUsdRateLookup({
    systemRates: systemExchangeRates,
    quoteCodes: usdRateQuoteCodes,
    windowStart: dataFetchMinDate,
  });

  const missingRateCurrencies = new Set<string>();
  const getExchangeRate = createGetExchangeRate({
    userBaseCurrencyCode: userBaseCurrency.currencyCode,
    userRatesMap,
    findLatestUsdRate: createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote }),
    onMissingRate: ({ currencyCode }) => missingRateCurrencies.add(currencyCode),
  });

  // A holding with no price on a snapshot day is carried at cost basis by the
  // replay, understating its price movement; collect which securities and which
  // days so the report can both warn the user and log the affected buckets.
  const unpricedSecurityIds = new Set<string>();
  const unpricedDates = new Set<string>();

  const transactionsByPortfolio = Map.groupBy(transactions, (tx) => tx.portfolioId);

  // Holdings take the sparse snapshot days: the replay folds every transaction
  // dated on or before each day, so skipping days between them changes nothing
  // and saves valuing every holding on every date.
  //
  // Replayed one portfolio at a time so each portfolio's growth is derived from its
  // own holdings and its own flows. The replay is already per-portfolio internally
  // and every fold downstream is linear over integer cents, so the totals summed
  // back up are the same numbers a single whole-scope pass would produce.
  const perPortfolioHoldings = portfolios.map((portfolio) => ({
    portfolio,
    valueByDate: computeHoldingsValueByDate({
      uniqueDates: boundaryDates,
      portfolioIds: [portfolio.id],
      transactionsByPortfolio,
      securitiesById,
      findPriceForDate,
      getExchangeRate,
      onMissingPrice: ({ securityId, dateStr }) => {
        unpricedSecurityIds.add(securityId);
        unpricedDates.add(dateStr);
      },
    }),
  }));

  // Cash, by contrast, only adds deltas landing exactly on a listed day, so a
  // sparse list would silently drop every delta in between. It gets every day.
  const cashInBaseByDate = computePortfolioCashByDate({
    cashDeltaByCurrencyDay: accumulateCashDeltas({
      transactions,
      portfolioTransfers,
      portfolioIdSet: new Set(portfolioIds),
    }),
    currentBalances,
    uniqueDates: denseDates,
    maxDate,
    getExchangeRate,
    // Same key the cash-row fetch was bounded with — avoids a midnight-boundary disagreement mid-request.
    todayKey,
  });

  // Both fallbacks silently distort the report, so both are logged with enough
  // to pin down the affected report: the snapshot window and, for prices, the
  // exact days a holding fell back to cost (`unpricedDates`). FX fallback is only
  // known per currency — the rate lookup does not surface the day it failed on —
  // so its dates are bounded by the window rather than listed.
  if (missingRateCurrencies.size > 0 || unpricedSecurityIds.size > 0) {
    // Info-only: the degradation is already surfaced via `unpricedSecurities` in
    // the response, and permanent price gaps would page Sentry on every request.
    logger.info('Net-worth drivers valued with degraded data', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      window: { from: minDate, to: maxDate },
      snapshotDates: boundaryDates,
      fxFallbackCurrencies: Array.from(missingRateCurrencies),
      unpricedSecurityIds: Array.from(unpricedSecurityIds),
      unpricedDates: Array.from(unpricedDates).toSorted(),
    });
  }

  const unpricedSecurities: NetWorthDriversUnpricedSecurity[] = Array.from(unpricedSecurityIds, (securityId) => {
    const label = securityLabelById.get(securityId);
    return { securityId: securityId as RecordId, symbol: label?.symbol ?? null, name: label?.name ?? null };
  });

  // The replays traffic in decimals; everything this service returns is cents. The
  // scope-wide holdings level is the per-date sum of the per-portfolio cents, so the
  // composition and the growth split are rounded once and identically.
  const holdingsCentsByDate = new Map<string, Cents>(boundaryDates.map((dateStr) => [dateStr, asCents(0)]));
  const series: PortfolioGrowthSeries[] = perPortfolioHoldings.map(({ portfolio, valueByDate }) => {
    const portfolioHoldingsCents = new Map<string, Cents>();
    let heldAnything = false;

    for (const dateStr of boundaryDates) {
      const holdingsValue = valueByDate.get(dateStr);
      // `computeHoldingsValueByDate` writes a value for every boundary day, so a miss is a
      // key-derivation bug, not a zero holding — surface it rather than value the day at zero.
      if (holdingsValue === undefined) {
        throw new UnexpectedError({
          message: `Net-worth drivers: holdings value missing for snapshot day ${dateStr}.`,
        });
      }

      const cents = Money.fromDecimal(holdingsValue).toCents();
      if (cents !== 0) heldAnything = true;
      portfolioHoldingsCents.set(dateStr, cents);
      holdingsCentsByDate.set(dateStr, asCents(holdingsCentsByDate.get(dateStr)! + cents));
    }

    const flows = accumulateInvestmentFlows({
      transactions: transactionsByPortfolio.get(portfolio.id) ?? [],
      boundaryDates,
    });

    return {
      portfolioId: portfolio.id,
      name: portfolio.name,
      growth: computeInvestmentGrowth({ flows, holdingsCentsByDate: portfolioHoldingsCents, boundaryDates }),
      hasActivity:
        heldAnything ||
        flows.some(
          (flow) =>
            flow.buyNotional !== 0 || flow.sellNotional !== 0 || flow.dividendsGross !== 0 || flow.feesAndTaxes !== 0,
        ),
    };
  });

  const cashCentsByDate = new Map<string, Cents>();
  for (const dateStr of denseDates) {
    // `computePortfolioCashByDate` omits days whose running cash nets to zero, so a missing
    // entry legitimately means zero cash — the fallback stays.
    cashCentsByDate.set(dateStr, Money.fromDecimal(cashInBaseByDate.get(dateStr) ?? 0).toCents());
  }

  const { totals, byBucket, legend } = foldPortfolioGrowth({
    series,
    bucketCount: Math.max(boundaryDates.length - 1, 0),
  });

  return {
    holdingsCentsByDate,
    cashCentsByDate,
    growth: totals,
    growthByPortfolio: byBucket,
    portfolios: legend,
    unpricedSecurities,
    fxFallbackCurrencies: Array.from(missingRateCurrencies),
  };
};

// `getAggregatedBalanceHistory` keys each day by `format(new Date(dateStr), 'yyyy-MM-dd')`
// — a `yyyy-MM-dd` string parsed as UTC midnight, then re-formatted in server-local time.
// Boundary calendar strings must pass through the identical transform to line up under a
// negative-offset server timezone; without it the lookup shifts a calendar day and the
// account-cash component silently reads as zero.
const toAccountsDateKey = (dayStr: string): string => format(new Date(dayStr), 'yyyy-MM-dd');

/**
 * Per-period breakdown of what grew the user's net worth: money they saved
 * (income minus expenses, transfers excluded) versus what the market returned on
 * their holdings, plus the holdings/cash split at each period end.
 *
 * Transfers are absent from both series by construction rather than by
 * subtraction — moving cash from a current account into a brokerage leaves
 * savings untouched (it is not income or expense) and holdings untouched (it
 * buys nothing), so it can never be mistaken for growth.
 *
 * All amounts are base-currency cents; the serializer converts to decimals.
 */
export const getNetWorthDrivers = async ({
  userId,
  from,
  to,
  granularity,
  portfolioIds,
}: GetNetWorthDriversParams): Promise<NetWorthDriversResultCents> => {
  const buckets = generatePeriodBuckets({ from, to, granularity });

  if (buckets.length === 0) {
    return { buckets: [], portfolios: [] };
  }

  const boundaryDates = buildBoundaryDates({ buckets });
  const denseDates = buildDenseDateRange({ boundaryDates });

  // One read transaction pins a single Postgres connection across the fan-out
  // below, rather than each branch checking out its own and a burst of report
  // loads draining the pool.
  const [savingsIntake, investmentSlice, accountsBalanceHistory] = await withTransaction(async () => {
    const userBaseCurrencyPromise = UsersCurrencies.findOne({
      where: { userId, isDefaultCurrency: true },
      raw: true,
      attributes: ['currencyCode'],
    }) as Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;

    return Promise.all([
      // Savings intake — real income and expense only, transfers dropped, user-wide.
      fetchSavingsTransactions({ userId, from, to }),
      calculateInvestmentSlice({
        userId,
        boundaryDates,
        denseDates,
        userBaseCurrencyPromise,
        portfolioIdsFilter: portfolioIds,
      }),
      // Cash side of the composition. Vehicles and loans are excluded to match
      // the net-worth chart's accounts partition; credit-card negatives stay in,
      // so the cash figure is a net position rather than a sum of what's liquid.
      getAggregatedBalanceHistory({
        userId,
        accountScope: 'owned',
        from: boundaryDates[0]!,
        to: boundaryDates[boundaryDates.length - 1]!,
        categoryFilter: { exclude: [ACCOUNT_CATEGORIES.vehicle, ACCOUNT_CATEGORIES.loan] },
      }),
    ]);
  })();

  const savings = accumulateSavings({
    transactions: savingsIntake.rows,
    refundPairs: savingsIntake.refundPairs,
    buckets,
  });

  const accountsCentsByDate = new Map(accountsBalanceHistory.map((item) => [item.date, asCents(item.amount)]));

  // `getAggregatedBalanceHistory` fills every day in its range, so a non-empty history that
  // misses a boundary day is a key-derivation bug, not zero cash. Fail loud rather than let
  // `?? 0` silently drop the whole account-cash component of this bucket's net worth. An empty
  // history (user with no account balances at all) is a real zero.
  const resolveAccountsCents = (periodEndKey: string): Cents => {
    const cents = accountsCentsByDate.get(toAccountsDateKey(periodEndKey));
    if (cents !== undefined) return cents;
    if (accountsBalanceHistory.length === 0) return asCents(0);

    logger.error('Net-worth drivers: account balance history missing a boundary day', {
      userId,
      periodEndKey,
      accountsDateKey: toAccountsDateKey(periodEndKey),
    });
    throw new UnexpectedError({
      message: 'Net-worth drivers: account balance history is missing a period-end day.',
    });
  };

  const resultBuckets = buckets.map((bucket, index) => {
    const periodEndKey = boundaryDates[index + 1]!;

    return {
      periodStart: format(bucket.periodStart, 'yyyy-MM-dd'),
      periodEnd: format(bucket.periodEnd, 'yyyy-MM-dd'),
      savings: savings[index]!,
      investments: { ...investmentSlice.growth[index]!, byPortfolio: investmentSlice.growthByPortfolio[index]! },
      composition: {
        // An empty investment slice (no portfolios or no investment data) leaves these two
        // maps empty, so a missing key is legitimately zero here.
        holdingsValue: investmentSlice.holdingsCentsByDate.get(periodEndKey) ?? asCents(0),
        cashValue: asCents(
          resolveAccountsCents(periodEndKey) + (investmentSlice.cashCentsByDate.get(periodEndKey) ?? 0),
        ),
      },
    };
  });

  const degraded = buildDegraded({
    unpricedSecurities: investmentSlice.unpricedSecurities,
    fxFallbackCurrencies: investmentSlice.fxFallbackCurrencies,
  });

  const result = { buckets: resultBuckets, portfolios: investmentSlice.portfolios };

  return degraded ? { ...result, degraded } : result;
};
