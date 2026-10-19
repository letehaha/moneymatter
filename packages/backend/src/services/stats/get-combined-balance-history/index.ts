import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import ExchangeRates from '@models/exchange-rates.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import { calculatePropertiesBalanceHistory } from '@services/stats/calculate-properties-balance-history';
import { calculateVehiclesBalanceHistory } from '@services/stats/calculate-vehicles-balance-history';
import { calculateVentureBalanceHistory } from '@services/stats/calculate-venture-balance-history';
import { getAggregatedBalanceHistory } from '@services/stats/get-balance-history';
import { getCreditLimitAdjustment } from '@services/stats/get-credit-limit-adjustment';
import { eachDayOfInterval, endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

import { resolveOldestEventDate } from './date-range';
import { buildUserRatesMap, createFindLatestUsdRate, createGetExchangeRate } from './exchange-rate-lookup';
import { computeHoldingsValueByDate } from './holdings-replay';
import { accumulateCashDeltas, computePortfolioCashByDate } from './portfolio-cash-replay';
import { buildPriceLookupWithPreWindowAnchors } from './security-price-anchors';
import { createFindPriceForDate } from './security-price-lookup';
import type { CombinedBalanceHistoryItem, CurrentBalanceRow, SecurityRow, TransactionRow, TransferRow } from './types';

export type { CombinedBalanceHistoryItem } from './types';

/**
 * Portfolio slice of the combined history. Runs independently of the accounts
 * balance calculation; the orchestrator merges the per-date values back in.
 */
const calculatePortfolioBalanceHistory = async ({
  userId,
  minDate,
  maxDate,
  uniqueDates,
  userBaseCurrencyPromise,
}: {
  userId: number;
  minDate: string;
  maxDate: string;
  uniqueDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
}): Promise<Map<string, number> | null> => {
  const [userBaseCurrency, portfolios] = await Promise.all([
    userBaseCurrencyPromise,
    Portfolios.findAll({
      where: { userId, isEnabled: true },
      attributes: ['id'],
      raw: true,
    }),
  ]);

  if (!userBaseCurrency?.currencyCode || portfolios.length === 0) {
    return null;
  }

  const portfolioIds = portfolios.map((p: { id: string }) => p.id);

  // Fetch cash rows through end-of-TODAY even when the window ends earlier:
  // `computePortfolioCashByDate` anchors on current stored cash and needs
  // every delta through today (see its doc) — otherwise post-window deltas
  // smear a constant offset across every historical day.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const cashFetchMaxDate = maxDate > todayKey ? maxDate : todayKey;

  const [transactions, portfolioTransfers, currentBalances]: [TransactionRow[], TransferRow[], CurrentBalanceRow[]] =
    await Promise.all([
      // `raw: true` + narrow attributes on purpose: there is deliberately no
      // lower date bound (pre-window rows seed opening holdings and cash), so
      // an active trader's full history loads here. Hydrating model instances
      // would materialize a Money object per money column per row — enough to
      // OOM under concurrent dashboard requests. DECIMALs arrive as strings.
      InvestmentTransaction.findAll({
        where: {
          portfolioId: { [Op.in]: portfolioIds },
          // `date` is TIMESTAMPTZ; end-of-day bound keeps the final day's intraday trades.
          date: { [Op.lte]: `${cashFetchMaxDate}T23:59:59.999Z` },
        },
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
      // Cash that settled inside a portfolio (deposits/withdrawals, account↔portfolio
      // transfers, portfolio↔portfolio moves, in-portfolio FX) is recorded here.
      // `date` is DATEONLY, so a `yyyy-MM-dd` upper bound compares as a plain string.
      // No lower bound: pre-window rows seed the opening cash balance in
      // `computePortfolioCashByDate`.
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
      // Stored cash position per portfolio/currency. Anchors the replay so
      // writers that bypass InvestmentTransaction/PortfolioTransfers — importer
      // cash seeds, the test/dev-only `PUT /portfolios/:id/balance` — still
      // surface in the chart.
      PortfolioBalances.findAll({
        where: { portfolioId: { [Op.in]: portfolioIds } },
        attributes: ['portfolioId', 'currencyCode', 'totalCash', 'refTotalCash'],
      }),
    ]);

  // A user with portfolios but no trades, transfers, or stored cash has nothing to chart.
  if (transactions.length === 0 && portfolioTransfers.length === 0 && currentBalances.length === 0) {
    return null;
  }

  const securityIds = [...new Set(transactions.map((t) => t.securityId))];

  // Look up securities to get the *security's* native currency and asset class.
  // Transactions store the cash-leg currency (often the brokerage's settlement
  // currency, e.g. USD for an ASML.AS purchase), which is NOT the right currency
  // for converting market value — prices are in the security's native currency.
  const securities: SecurityRow[] = await Securities.findAll({
    where: { id: { [Op.in]: securityIds } },
    attributes: ['id', 'currencyCode', 'assetClass'],
    raw: true,
  });
  const securitiesById = new Map(securities.map((s) => [s.id, s]));

  // Every currency needing a base-conversion rate: security currencies plus
  // cash-leg currencies of transactions, transfers, and stored balances (a
  // direct-write seeded currency may have no tx/transfer row). Missing one
  // here means the USD-pivot loader skips it and it silently converts 1:1.
  const cashCurrencyCodes: string[] = [];
  for (const tx of transactions) cashCurrencyCodes.push(tx.settlementCurrencyCode);
  for (const tr of portfolioTransfers) {
    cashCurrencyCodes.push(tr.currencyCode);
    if (tr.toCurrencyCode) cashCurrencyCodes.push(tr.toCurrencyCode);
  }
  for (const b of currentBalances) cashCurrencyCodes.push(b.currencyCode);
  const currencyCodes = [...new Set([...securities.map((s) => s.currencyCode), ...cashCurrencyCodes])];

  // Fetch starting 7 days before minDate to ensure fallback lookups have prior
  // trading-day data available for weekends/holidays.
  const dataFetchMinDate = format(subDays(parseISO(minDate), 7), 'yyyy-MM-dd');

  // Currencies we need a `USD → X` rate for: every cash/security currency PLUS
  // the user's base currency (used as the numerator in the cross-rate). USD
  // itself is excluded because `findLatestUsdRate` short-circuits to 1 for it.
  const usdRateQuoteCodes = [...new Set([userBaseCurrency.currencyCode, ...currencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  const [securityPrices, userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    SecurityPricing.findAll({
      where: {
        securityId: { [Op.in]: securityIds },
        // `date` is TIMESTAMPTZ; end-of-day bound keeps the final day's intraday rows.
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
    // System rates are stored only canonically: `baseCode = USD, quoteCode = X`
    // (1 USD = N X). Fetch that direction for every needed currency plus the
    // user's base; `createGetExchangeRate` computes the cross-rate (see its
    // doc for the sync constraint with the main FX service).
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

  // Seed the lookup with one pre-window anchor per security so a holding whose last stored
  // price predates the fetched window still values at that price instead of collapsing to
  // cost basis and fabricating a price move.
  const findPriceForDate = createFindPriceForDate(
    await buildPriceLookupWithPreWindowAnchors({
      windowPrices: securityPrices,
      securityIds,
      windowStart: dataFetchMinDate,
    }),
  );

  const userRatesMap = buildUserRatesMap(userCustomExchangeRates);

  // The lookup is seeded with one rate from before the window so a currency
  // whose latest stored rate predates the chart range still resolves instead
  // of collapsing to 1:1.
  const { usdRatesMap, usdRateDatesByQuote } = await buildUsdRateLookup({
    systemRates: systemExchangeRates,
    quoteCodes: usdRateQuoteCodes,
    windowStart: dataFetchMinDate,
  });

  const missingRateCurrencies = new Set<string>();
  const approximatedRateCurrencies = new Set<string>();
  const findLatestUsdRate = createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote });
  const getExchangeRate = createGetExchangeRate({
    userBaseCurrencyCode: userBaseCurrency.currencyCode,
    userRatesMap,
    findLatestUsdRate,
    onMissingRate: ({ currencyCode, approximated }) =>
      (approximated ? approximatedRateCurrencies : missingRateCurrencies).add(currencyCode),
  });

  const transactionsByPortfolio = Map.groupBy(transactions, (tx) => tx.portfolioId);

  // Holdings give securities market value; portfolio cash (deposits, sale/dividend
  // proceeds, transfers, in-portfolio FX) lives in `PortfolioBalances` and must
  // be added so the trend matches the portfolio detail page (`getPortfolioSummary`
  // = holdings + cash).
  const cashDeltaByCurrencyDay = accumulateCashDeltas({
    transactions,
    portfolioTransfers,
    portfolioIdSet: new Set(portfolioIds),
  });

  const cashInBaseByDate = computePortfolioCashByDate({
    cashDeltaByCurrencyDay,
    currentBalances,
    uniqueDates,
    maxDate,
    getExchangeRate,
    // Same key the cash-row fetch was bounded with — avoids a midnight-boundary disagreement mid-request.
    todayKey,
  });

  // A holding with no price on a day is carried at cost basis by the replay, understating
  // its price movement; collect which securities and which days so the fallback is logged.
  const unpricedSecurityIds = new Set<string>();
  const unpricedDates = new Set<string>();

  const holdingsValueByDate = computeHoldingsValueByDate({
    uniqueDates,
    portfolioIds,
    transactionsByPortfolio,
    securitiesById,
    findPriceForDate,
    getExchangeRate,
    onMissingPrice: ({ securityId, dateStr }) => {
      unpricedSecurityIds.add(securityId);
      unpricedDates.add(dateStr);
    },
  });

  const portfolioValuesByDate = new Map<string, number>();
  for (const dateStr of uniqueDates) {
    const holdingsForDate = holdingsValueByDate.get(dateStr) ?? 0;
    const cashForDate = cashInBaseByDate.get(dateStr) ?? 0;
    portfolioValuesByDate.set(dateStr, Money.fromDecimal(holdingsForDate + cashForDate).toCents());
  }

  // Error (not warn) so the fallback reaches Sentry: silent 1:1 conversion is
  // a known production failure mode (MONEY-MATTER-BACKEND-7B). Aggregated to
  // one log per request rather than one per lookup.
  if (missingRateCurrencies.size > 0) {
    logger.error('Exchange rate fallback to 1:1', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(missingRateCurrencies),
      dateRange: { from: minDate, to: maxDate },
    });
  }

  // Info-only: a range reaching back past a currency's first stored rate is
  // approximated on every request, so an error here would repeat forever.
  if (approximatedRateCurrencies.size > 0) {
    logger.info('Combined balance history converted days before the first stored exchange rate at that rate', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(approximatedRateCurrencies),
      dateRange: { from: minDate, to: maxDate },
    });
  }

  // Holdings without a price fall back to cost basis, understating market value.
  // Info-only: price gaps can be permanent (delisted tickers, provider history
  // caps), so a per-request Sentry event would repeat forever.
  if (unpricedSecurityIds.size > 0) {
    logger.info('Combined balance history valued holdings at cost basis for unpriced days', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      dateRange: { from: minDate, to: maxDate },
      unpricedSecurityIds: Array.from(unpricedSecurityIds),
      unpricedDates: Array.from(unpricedDates).toSorted(),
    });
  }

  return portfolioValuesByDate;
};

/**
 * Daily balance snapshots (accounts, portfolios, ventures, vehicles, total)
 * for a user within an inclusive `yyyy-MM-dd` date range. Portfolio values
 * are replayed from transaction history against daily prices. When `from` is
 * omitted the window extends back to the oldest recorded event
 * (`resolveOldestEventDate`).
 */
export const getCombinedBalanceHistory = async ({
  userId,
  from,
  to,
  includeCreditLimit = false,
}: {
  userId: number;
  from?: string;
  to?: string;
  includeCreditLimit?: boolean;
}): Promise<CombinedBalanceHistoryItem[]> => {
  try {
    const maxDate = to || format(new Date(), 'yyyy-MM-dd');
    const minDate = from ?? (await resolveOldestEventDate({ userId, fallback: maxDate }));

    const uniqueDates = eachDayOfInterval({
      start: parseISO(minDate),
      end: parseISO(maxDate),
    }).map((date) => format(date, 'yyyy-MM-dd'));

    // One read transaction pins a single Postgres connection for the whole
    // parallel fan-out below (cls-hooked propagates it into every branch, so
    // the sub-calculators' queries queue on that one connection). The branches
    // are all cheap index scans, so serializing them costs little — while one
    // connection per branch would let a burst of dashboard loads exhaust the
    // pool's warm connections and pay slow physical `pg.connect` + session
    // setup in the middle of the request.
    const [
      accountsBalanceHistory,
      loansBalanceHistory,
      vehicleValuesByDate,
      propertyValuesByDate,
      portfolioValuesByDate,
      ventureValuesByDate,
      creditLimitSum,
    ] = await withTransaction(async () => {
      // Shared by every sub-calculator that converts to base currency — fetch once.
      const userBaseCurrencyPromise = UsersCurrencies.findOne({
        where: { userId, isDefaultCurrency: true },
        raw: true,
        attributes: ['currencyCode'],
      }) as Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;

      // Split accounts/vehicles/properties/loans into separate filtered
      // aggregations so each keeps its own forward-fill partition (otherwise
      // vehicle/property/loan anchor dates would forward-fill into the
      // cash-accounts series).
      return Promise.all([
        getAggregatedBalanceHistory({
          userId,
          accountScope: 'owned',
          from: minDate,
          to: maxDate,
          categoryFilter: {
            exclude: [ACCOUNT_CATEGORIES.vehicle, ACCOUNT_CATEGORIES.property, ACCOUNT_CATEGORIES.loan],
          },
        }),
        (async () => {
          // Back-fill each loan's pre-anchor days from its opening balance
          // (`refInitialBalance` — the outstanding as-of the anchor date) rather than
          // from the anchor-day Balances row. A payment only ever writes
          // `currentBalance`, so the opening is immutable; this stops a payoff dated
          // on the anchor day (which folds the anchor row toward zero) from
          // retroactively rewriting the loan balance shown on earlier days.
          const loanAccounts = await Accounts.findAll({
            where: { userId, accountCategory: ACCOUNT_CATEGORIES.loan, excludeFromStats: false },
            attributes: ['id', 'refInitialBalance'],
          });
          const openingCentsByAccount = new Map(loanAccounts.map((a) => [a.id, a.refInitialBalance.toCents()]));

          return getAggregatedBalanceHistory({
            userId,
            accountScope: 'owned',
            from: minDate,
            to: maxDate,
            categoryFilter: { only: [ACCOUNT_CATEGORIES.loan] },
            openingCentsByAccount,
          });
        })(),
        calculateVehiclesBalanceHistory({ userId, maxDate, uniqueDates, userBaseCurrencyPromise }),
        calculatePropertiesBalanceHistory({ userId, maxDate, uniqueDates, userBaseCurrencyPromise }),
        calculatePortfolioBalanceHistory({ userId, minDate, maxDate, uniqueDates, userBaseCurrencyPromise }),
        calculateVentureBalanceHistory({ userId, minDate, maxDate, uniqueDates, userBaseCurrencyPromise }),
        includeCreditLimit ? getCreditLimitAdjustment({ userId, accountScope: 'owned' }) : Promise.resolve(0),
      ]);
    })();

    if (
      (!accountsBalanceHistory || accountsBalanceHistory.length === 0) &&
      (!loansBalanceHistory || loansBalanceHistory.length === 0) &&
      (!vehicleValuesByDate || vehicleValuesByDate.size === 0) &&
      (!propertyValuesByDate || propertyValuesByDate.size === 0) &&
      (!portfolioValuesByDate || portfolioValuesByDate.size === 0) &&
      (!ventureValuesByDate || ventureValuesByDate.size === 0)
    ) {
      return [];
    }

    // Build Maps for O(1) lookup instead of O(n) find on each merge cell.
    const accountsBalanceByDate = new Map<string, number>();
    for (const item of accountsBalanceHistory) {
      accountsBalanceByDate.set(item.date, item.amount);
    }

    const loansBalanceByDate = new Map<string, number>();
    for (const item of loansBalanceHistory) {
      loansBalanceByDate.set(item.date, item.amount);
    }

    const combinedHistory: CombinedBalanceHistoryItem[] = uniqueDates.map((dateStr) => {
      const accountsBalance = (accountsBalanceByDate.get(dateStr) ?? 0) - creditLimitSum;
      const vehiclesBalance = vehicleValuesByDate?.get(dateStr) ?? 0;
      const propertiesBalance = propertyValuesByDate?.get(dateStr) ?? 0;
      const portfoliosBalance = portfolioValuesByDate?.get(dateStr) ?? 0;
      const venturesBalance = ventureValuesByDate?.get(dateStr) ?? 0;
      const loansBalance = loansBalanceByDate.get(dateStr) ?? 0;

      return {
        date: dateStr,
        accountsBalance,
        portfoliosBalance,
        venturesBalance,
        vehiclesBalance,
        propertiesBalance,
        loansBalance,
        totalBalance:
          accountsBalance + portfoliosBalance + venturesBalance + vehiclesBalance + propertiesBalance + loansBalance,
      };
    });

    return combinedHistory;
  } catch (err) {
    console.error('Error getting optimized combined balance history:', err);
    throw err;
  }
};
