import type { Cents, NetWorthHistoryUnpricedSecurity, RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import ExchangeRates from '@models/exchange-rates.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import { getScopedEnabledPortfolios } from '@services/stats/utils';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

// The holdings/cash replays and their price + FX lookups are shared with
// `get-combined-balance-history`, deliberately: the net-worth history's portfolio
// values must agree with the combined balance chart, and forking the replay would
// let the two drift apart on every future fix.
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
import type {
  CurrentBalanceRow,
  SecurityRow,
  TransactionRow,
  TransferRow,
} from '../get-combined-balance-history/types';

/**
 * Portfolio valuation for the net-worth history report: a per-snapshot-date map of
 * value in base-currency cents, plus the data-quality failures that made any value
 * approximate (so the caller can forward them to the client as `degraded`).
 */
interface PortfolioValuation {
  /**
   * Value (holdings market value + uninvested cash) per snapshot date, or null when
   * the user has nothing to value (no enabled portfolios, no investment data, or no
   * base currency to convert into) — the caller treats a missing map as zero,
   * matching the combined balance chart.
   */
  valuesByDate: Map<string, Cents> | null;
  /** Holdings carried at cost basis for lack of a price; empty when every holding priced. */
  unpricedSecurities: NetWorthHistoryUnpricedSecurity[];
  /**
   * ISO codes converted without a real rate for the day: at the currency's earliest
   * stored rate for earlier dates, or 1:1 when none is stored. Empty when all resolved.
   */
  fxFallbackCurrencies: string[];
}

const NOTHING_TO_VALUE: PortfolioValuation = { valuesByDate: null, unpricedSecurities: [], fxFallbackCurrencies: [] };

/**
 * Portfolio value (holdings market value + uninvested cash) in base-currency cents
 * for each snapshot date. Holdings are valued on the sparse `snapshotDates` only —
 * the replay folds every transaction dated on or before each day, so skipping the
 * days in between changes nothing and keeps an all-time range cheap. Cash, by
 * contrast, only adds deltas landing exactly on a listed day, so it replays over
 * `denseDates` and the caller reads the snapshot days back out.
 */
export const calculatePortfolioValueByDate = async ({
  userId,
  snapshotDates,
  denseDates,
  userBaseCurrencyPromise,
}: {
  userId: number;
  snapshotDates: string[];
  denseDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
}): Promise<PortfolioValuation> => {
  const minDate = snapshotDates[0]!;
  const maxDate = snapshotDates[snapshotDates.length - 1]!;

  const [userBaseCurrency, portfolios] = await Promise.all([
    userBaseCurrencyPromise,
    getScopedEnabledPortfolios({ userId }),
  ]);

  if (portfolios.length === 0) {
    return NOTHING_TO_VALUE;
  }

  // No base currency means there is nothing to convert into, but it should
  // never happen — every user has one. Log it so the silent zero-out is visible.
  if (!userBaseCurrency?.currencyCode) {
    logger.error('Net-worth history: user has no base currency', { userId });
    return NOTHING_TO_VALUE;
  }

  const portfolioIds = portfolios.map((portfolio) => portfolio.id);

  // Cash rows must reach through end-of-TODAY even when the window ends earlier:
  // `computePortfolioCashByDate` anchors on stored cash and back-subtracts every
  // delta through today (see its doc), so a narrower fetch offsets every day.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const cashFetchMaxDate = maxDate > todayKey ? maxDate : todayKey;

  const [transactions, portfolioTransfers, currentBalances]: [TransactionRow[], TransferRow[], CurrentBalanceRow[]] =
    await Promise.all([
      // `raw: true` + cast so the DECIMAL money columns (`quantity` is a Money
      // field on the model) arrive as strings, the shape the shared holdings
      // replay expects — and to avoid hydrating a Money object per column per row
      // across an active trader's full pre-window history.
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
          'currencyCode',
          'settlementAmount',
          'settlementCurrencyCode',
        ],
        raw: true,
      }) as unknown as Promise<TransactionRow[]>,
      PortfolioTransfers.findAll({
        where: {
          userId,
          affectsCash: true,
          date: { [Op.lte]: cashFetchMaxDate },
          [Op.or]: [{ fromPortfolioId: { [Op.in]: portfolioIds } }, { toPortfolioId: { [Op.in]: portfolioIds } }],
        },
        attributes: [
          'fromPortfolioId',
          'toPortfolioId',
          'amount',
          'currencyCode',
          'toCurrencyCode',
          'toAmount',
          'date',
        ],
      }),
      PortfolioBalances.findAll({
        where: { portfolioId: { [Op.in]: portfolioIds } },
        attributes: ['portfolioId', 'currencyCode', 'totalCash', 'refTotalCash'],
      }),
    ]);

  if (transactions.length === 0 && portfolioTransfers.length === 0 && currentBalances.length === 0) {
    return NOTHING_TO_VALUE;
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
  const approximatedRateCurrencies = new Set<string>();
  const getExchangeRate = createGetExchangeRate({
    userBaseCurrencyCode: userBaseCurrency.currencyCode,
    userRatesMap,
    findLatestUsdRate: createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote }),
    onMissingRate: ({ currencyCode, approximated }) =>
      (approximated ? approximatedRateCurrencies : missingRateCurrencies).add(currencyCode),
  });

  // A holding with no price on a snapshot day is carried at cost basis by the
  // replay, understating its price movement; collect which securities and which
  // days so the degraded valuation is logged.
  const unpricedSecurityIds = new Set<string>();
  const unpricedDates = new Set<string>();

  const holdingsValueByDate = computeHoldingsValueByDate({
    uniqueDates: snapshotDates,
    portfolioIds,
    transactionsByPortfolio: Map.groupBy(transactions, (tx) => tx.portfolioId),
    securitiesById,
    findPriceForDate,
    getExchangeRate,
    onMissingPrice: ({ securityId, dateStr }) => {
      unpricedSecurityIds.add(securityId);
      unpricedDates.add(dateStr);
    },
  });

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

  // Error (not warn) so the fallback reaches Sentry: silent 1:1 conversion is a
  // known production failure mode. Aggregated to one log per request.
  if (missingRateCurrencies.size > 0) {
    logger.error('Net-worth history exchange rate fallback to 1:1', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(missingRateCurrencies),
      dateRange: { from: minDate, to: maxDate },
    });
  }

  // Info-only: the degradation is already surfaced via `fxFallbackCurrencies` in
  // the response, and a range reaching back past a currency's first stored rate
  // is approximated on every request.
  if (approximatedRateCurrencies.size > 0) {
    logger.info('Net-worth history converted days before the first stored exchange rate at that rate', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(approximatedRateCurrencies),
      dateRange: { from: minDate, to: maxDate },
    });
  }

  // Info-only: the degradation is already surfaced via `unpricedSecurities` in
  // the response, and permanent price gaps would page Sentry on every request.
  if (unpricedSecurityIds.size > 0) {
    logger.info('Net-worth history valued holdings at cost basis for unpriced days', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      dateRange: { from: minDate, to: maxDate },
      unpricedSecurityIds: Array.from(unpricedSecurityIds),
      unpricedDates: Array.from(unpricedDates).toSorted(),
    });
  }

  const unpricedSecurities: NetWorthHistoryUnpricedSecurity[] = Array.from(unpricedSecurityIds, (securityId) => {
    const label = securityLabelById.get(securityId);
    return { securityId: securityId as RecordId, symbol: label?.symbol ?? null, name: label?.name ?? null };
  });

  // The replays traffic in decimals; everything this service returns is cents.
  const portfolioValueByDate = new Map<string, Cents>();
  for (const dateStr of snapshotDates) {
    const holdingsForDate = holdingsValueByDate.get(dateStr) ?? 0;
    const cashForDate = cashInBaseByDate.get(dateStr) ?? 0;
    portfolioValueByDate.set(dateStr, Money.fromDecimal(holdingsForDate).add(Money.fromDecimal(cashForDate)).toCents());
  }

  return {
    valuesByDate: portfolioValueByDate,
    unpricedSecurities,
    fxFallbackCurrencies: [...new Set([...missingRateCurrencies, ...approximatedRateCurrencies])],
  };
};
