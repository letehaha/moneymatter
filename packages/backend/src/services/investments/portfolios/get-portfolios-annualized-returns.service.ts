import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';
import { toUtcDateString } from '@common/utils/date';
import { logger } from '@js/utils';
import ExchangeRates from '@models/exchange-rates.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import {
  createFindLatestUsdRate,
  createGetExchangeRate,
} from '@services/stats/get-combined-balance-history/exchange-rate-lookup';
import { differenceInDays, endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

/**
 * Minimum tracked history (in days) before an annualized figure is shown.
 * Annualizing a return from a few weeks of data inflates noise into a wild
 * yearly number, so anything shorter is reported as "not enough history".
 */
const MIN_HISTORY_DAYS = 180;

/**
 * Days of price/rate history to pre-fetch before the first trade so the
 * "latest value on or before a date" fallback has prior trading-day data to
 * walk back to across weekends/holidays.
 */
const FALLBACK_LOOKBACK_DAYS = 7;

interface GetPortfoliosAnnualizedReturnsParams {
  userId: number;
}

// Raw query — decimal Money columns come back as Postgres-formatted strings
// (`'12.3400000000'`), not hydrated Money instances. Convert with `Number(...)`
// at the use site; precision loss matches the prior `Money.toNumber()` path.
//
// `date` is a timestamptz column, so node-postgres returns a JS `Date` here even
// on this raw query. Day-level logic normalizes it to a UTC calendar day with
// `toUtcDateString` before bucketing or comparing.
type TransactionRow = Pick<InvestmentTransaction, 'portfolioId' | 'securityId' | 'category' | 'date'> & {
  quantity: string;
  refAmount: string;
};

/** Running per-security position used to value the portfolio over time. */
interface HoldingState {
  quantity: number;
  /**
   * Total cost basis in the user's base currency. Used as the valuation
   * fallback when no market price is available on a given date (e.g. a
   * back-dated buy that precedes the security's price history).
   */
  costBasis: number;
}

/**
 * Computes the annualized time-weighted return (TWR) of each enabled portfolio
 * over its full tracked history, expressed in the user's base currency.
 *
 * TWR is the right metric for the investment calculator: it measures how the
 * *holdings themselves* performed, stripping out the timing and size of the
 * user's contributions (the calculator already models contributions separately,
 * so a contribution-sensitive metric like XIRR would double-count them).
 *
 * Method — daily values aren't stored, so the portfolio is valued only at the
 * dates where holdings change (every buy/sell) plus today. Between two such
 * boundaries the holdings are fixed, so the sub-period return collapses to a
 * pure price ratio `value(end) / value(start)`. Chaining those ratios yields
 * the TWR; dividends received within a sub-period are added to its ending value
 * as return-without-new-capital. Buys/sells are NOT treated as returns because
 * the same day-close price is used for both the valuation and the share delta,
 * so a trade contributes ~0 to its own day's return.
 *
 * FX — all exchange rates are bulk-loaded once and converted in memory (mirrors
 * `get-combined-balance-history`). Valuing each boundary with a per-date
 * `calculateRefAmount` round-trip instead would issue dozens of serial DB
 * queries per request; keep the two cross-rate implementations in sync.
 */
export const getPortfoliosAnnualizedReturns = async ({
  userId,
}: GetPortfoliosAnnualizedReturnsParams): Promise<PortfolioAnnualizedReturnModel[]> => {
  const [userBaseCurrency, portfolios] = await Promise.all([
    UsersCurrencies.findOne({
      where: { userId, isDefaultCurrency: true },
      raw: true,
      attributes: ['currencyCode'],
    }) as Promise<Pick<UsersCurrencies, 'currencyCode'> | null>,
    Portfolios.findAll({
      where: { userId, isEnabled: true },
      attributes: ['id', 'name'],
      raw: true,
    }) as Promise<Pick<Portfolios, 'id' | 'name'>[]>,
  ]);

  if (!userBaseCurrency?.currencyCode || portfolios.length === 0) {
    return [];
  }

  const baseCurrencyCode = userBaseCurrency.currencyCode;
  const today = toUtcDateString(new Date());
  // Inclusive end of today in UTC for the `date` filter. `date` is a timestamptz,
  // so a bare `Op.lte: today` ('YYYY-MM-DD') would cast to today's midnight and
  // silently drop every trade timestamped later in the day. Bounding by the last
  // UTC instant of today instead keeps all of today's trades, host-TZ-agnostic.
  const todayEndOfDayUtc = `${today}T23:59:59.999Z`;
  const portfolioIds = portfolios.map((p) => p.id);

  // Only buys/sells (holdings changes) and dividends (income return) matter for
  // TWR. Other categories (transfer, fee, tax, cancel, other) are cash-side
  // movements that don't affect security market value or investment return.
  const transactions: TransactionRow[] = (await InvestmentTransaction.findAll({
    where: {
      portfolioId: { [Op.in]: portfolioIds },
      category: {
        [Op.in]: [
          INVESTMENT_TRANSACTION_CATEGORY.buy,
          INVESTMENT_TRANSACTION_CATEGORY.sell,
          INVESTMENT_TRANSACTION_CATEGORY.dividend,
        ],
      },
      date: { [Op.lte]: todayEndOfDayUtc },
    },
    order: [
      ['portfolioId', 'ASC'],
      ['date', 'ASC'],
      ['createdAt', 'ASC'],
    ],
    attributes: ['portfolioId', 'securityId', 'category', 'date', 'quantity', 'refAmount'],
    raw: true,
  })) as unknown as TransactionRow[];

  const securityIds = [...new Set(transactions.map((t) => t.securityId))];

  type SecurityRow = Pick<Securities, 'id' | 'currencyCode' | 'assetClass'>;
  const securities: SecurityRow[] = securityIds.length
    ? ((await Securities.findAll({
        where: { id: { [Op.in]: securityIds } },
        attributes: ['id', 'currencyCode', 'assetClass'],
        raw: true,
      })) as SecurityRow[])
    : [];
  const securitiesById = new Map(securities.map((s) => [String(s.id), s]));
  const currencyCodes = [...new Set(securities.map((s) => s.currencyCode))];

  // Earliest trade date bounds how far back rates need to be loaded. Normalize
  // each timestamptz to its UTC calendar day so the comparison and the stored
  // value stay `YYYY-MM-DD` strings (consumed by `parseISO` below).
  let earliestDate: string | null = null;
  for (const tx of transactions) {
    const txDate = toUtcDateString(tx.date);
    if (earliestDate === null || txDate < earliestDate) earliestDate = txDate;
  }
  const dataFetchMinDate = earliestDate
    ? format(subDays(parseISO(earliestDate), FALLBACK_LOOKBACK_DAYS), 'yyyy-MM-dd')
    : today;

  // Currencies we need a `USD → X` rate for: every security currency PLUS the
  // user's base currency (the numerator in the cross-rate). USD itself is
  // excluded because `findLatestUsdRate` short-circuits to 1 for it.
  const usdRateQuoteCodes = [...new Set([baseCurrencyCode, ...currencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  type SecurityPriceRow = Pick<SecurityPricing, 'securityId' | 'date'> & { priceClose: string };
  type UserRateRow = Pick<UserExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate'>;
  type SystemRateRow = Pick<ExchangeRates, 'quoteCode' | 'date' | 'rate'>;

  const [securityPrices, userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    securityIds.length
      ? (SecurityPricing.findAll({
          where: {
            securityId: { [Op.in]: securityIds },
            // Crypto writes intraday rows hourly, so the unbounded variant of
            // this query pulled the entire price history of every traded
            // security. Bounding by the data window cuts both row count and
            // downstream `findPriceForDate` scan length.
            date: { [Op.between]: [startOfDay(parseISO(dataFetchMinDate)), endOfDay(parseISO(today))] },
          },
          order: [
            ['securityId', 'ASC'],
            ['date', 'ASC'],
          ],
          attributes: ['securityId', 'date', 'priceClose'],
          raw: true,
        }) as unknown as Promise<SecurityPriceRow[]>)
      : Promise.resolve([] as SecurityPriceRow[]),
    // User-set overrides — stored directly as `currencyCode → userBase`.
    currencyCodes.length
      ? (UserExchangeRates.findAll({
          where: {
            userId,
            baseCode: { [Op.in]: currencyCodes },
            quoteCode: baseCurrencyCode,
            date: { [Op.between]: [dataFetchMinDate, today] },
          },
          attributes: ['baseCode', 'quoteCode', 'date', 'rate'],
          raw: true,
        }) as Promise<UserRateRow[]>)
      : Promise.resolve([] as UserRateRow[]),
    // System rates are stored only as `baseCode = USD, quoteCode = X` (1 USD = N X).
    // Query that direction for every currency we convert from AND the user's
    // base currency, then derive the cross-rate in `getExchangeRate` below.
    usdRateQuoteCodes.length
      ? (ExchangeRates.findAll({
          where: {
            baseCode: API_LAYER_BASE_CURRENCY_CODE,
            quoteCode: { [Op.in]: usdRateQuoteCodes },
            date: { [Op.between]: [startOfDay(parseISO(dataFetchMinDate)), endOfDay(parseISO(today))] },
          },
          order: [
            ['quoteCode', 'ASC'],
            ['date', 'ASC'],
          ],
          attributes: ['quoteCode', 'date', 'rate'],
          raw: true,
        }) as Promise<SystemRateRow[]>)
      : Promise.resolve([] as SystemRateRow[]),
  ]);

  // One price series per security, ascending by date, for fallback lookups
  // ("latest price on or before a date" covers weekends/holidays).
  const pricesBySecurity = new Map<string, Array<{ date: string; price: number }>>();
  for (const row of securityPrices) {
    const dateStr = toUtcDateString(row.date);
    const list = pricesBySecurity.get(row.securityId);
    const entry = { date: dateStr, price: Number(row.priceClose) };
    if (list) {
      // Crypto carries intraday rows; later same-day write wins the daily bucket.
      const last = list[list.length - 1];
      if (last && last.date === dateStr) last.price = entry.price;
      else list.push(entry);
    } else {
      pricesBySecurity.set(row.securityId, [entry]);
    }
  }

  const findPriceForDate = (securityId: string, targetDate: string): number | null => {
    const prices = pricesBySecurity.get(securityId);
    if (!prices || prices.length === 0) return null;
    let latest: number | null = null;
    for (const p of prices) {
      if (p.date <= targetDate) latest = p.price;
      else break;
    }
    return latest;
  };

  // User overrides (`currencyCode → userBase`) win over the computed cross-rate.
  const userRatesMap = new Map<string, number>();
  for (const r of userCustomExchangeRates) {
    userRatesMap.set(`${r.baseCode}_${toUtcDateString(r.date)}`, r.rate);
  }

  // System rates indexed by `${quoteCode}_${dateStr}` — value is `1 USD = N quoteCode`.
  const usdRatesMap = new Map<string, number>();
  // Per-currency sorted (ascending) date list for the weekend/holiday fallback.
  const usdRateDatesByQuote = new Map<string, string[]>();
  for (const rate of systemExchangeRates) {
    const dateStr = toUtcDateString(rate.date);
    usdRatesMap.set(`${rate.quoteCode}_${dateStr}`, rate.rate);
    const dates = usdRateDatesByQuote.get(rate.quoteCode);
    if (dates) dates.push(dateStr);
    else usdRateDatesByQuote.set(rate.quoteCode, [dateStr]);
  }

  const missingRateCurrencies = new Set<string>();
  const getExchangeRate = createGetExchangeRate({
    userBaseCurrencyCode: baseCurrencyCode,
    userRatesMap,
    findLatestUsdRate: createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote }),
    onMissingRate: ({ currencyCode, approximated }) => {
      if (!approximated) missingRateCurrencies.add(currencyCode);
    },
  });

  // Market value (base currency) of a holdings map valued at `dateStr`.
  const valueHoldings = (holdings: Map<string, HoldingState>, dateStr: string): number => {
    let total = 0;
    for (const [securityId, holding] of holdings) {
      const security = securitiesById.get(securityId);
      // Stocks can't be negative; crypto may legitimately drift negative.
      const allowNegative = security?.assetClass === ASSET_CLASS.crypto;
      const effectiveQuantity = !allowNegative && holding.quantity < 0 ? 0 : holding.quantity;
      if (effectiveQuantity === 0) continue;
      const price = findPriceForDate(securityId, dateStr);
      if (price === null) {
        // No market price on/before this date (e.g. a back-dated buy that
        // precedes the security's price history). Fall back to cost basis —
        // already in base currency — so the position is valued consistently at
        // both ends of a sub-period instead of jumping 0 → market value and
        // injecting a phantom return. Mirrors `get-combined-balance-history`.
        total += holding.costBasis;
        continue;
      }
      const rate = getExchangeRate(security?.currencyCode ?? baseCurrencyCode, dateStr);
      total += effectiveQuantity * price * rate;
    }
    return total;
  };

  const transactionsByPortfolio = new Map<string, TransactionRow[]>();
  for (const tx of transactions) {
    const list = transactionsByPortfolio.get(tx.portfolioId);
    if (list) list.push(tx);
    else transactionsByPortfolio.set(tx.portfolioId, [tx]);
  }

  const results: PortfolioAnnualizedReturnModel[] = [];

  for (const portfolio of portfolios) {
    const portfolioTxs = transactionsByPortfolio.get(portfolio.id) ?? [];
    const tradeTxs = portfolioTxs.filter(
      (t) => t.category === INVESTMENT_TRANSACTION_CATEGORY.buy || t.category === INVESTMENT_TRANSACTION_CATEGORY.sell,
    );

    if (tradeTxs.length === 0) {
      results.push({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        annualizedReturn: null,
        hasEnoughHistory: false,
        startDate: null,
        periodDays: 0,
        currencyCode: baseCurrencyCode,
      });
      continue;
    }

    // UTC calendar day of the first trade. Kept as `YYYY-MM-DD` so `parseISO`
    // below and the `startDate` API field (typed `string`) both receive a day.
    const startDate = toUtcDateString(tradeTxs[0]!.date);
    const periodDays = differenceInDays(parseISO(today), parseISO(startDate));

    if (periodDays < MIN_HISTORY_DAYS) {
      results.push({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        annualizedReturn: null,
        hasEnoughHistory: false,
        startDate,
        periodDays: Math.max(periodDays, 0),
        currencyCode: baseCurrencyCode,
      });
      continue;
    }

    // Group trades by date and collect dividends as a sorted list of returns.
    // Buckets are keyed by the UTC calendar day, never the raw timestamptz —
    // a `Date` key would make every transaction its own bucket instead of
    // collapsing same-day trades into one boundary.
    const tradesByDate = new Map<string, TransactionRow[]>();
    const dividends: Array<{ date: string; amount: number }> = [];
    for (const tx of portfolioTxs) {
      const txDate = toUtcDateString(tx.date);
      if (tx.category === INVESTMENT_TRANSACTION_CATEGORY.dividend) {
        dividends.push({ date: txDate, amount: Number(tx.refAmount) });
        continue;
      }
      const list = tradesByDate.get(txDate);
      if (list) list.push(tx);
      else tradesByDate.set(txDate, [tx]);
    }

    const boundaryDates = [...tradesByDate.keys()].toSorted();
    if (boundaryDates[boundaryDates.length - 1] !== today) boundaryDates.push(today);

    const holdings = new Map<string, HoldingState>();
    let cumulativeFactor = 1;
    let prevValue = 0;
    let prevDate: string | null = null;
    let started = false;
    let dividendIdx = 0;

    for (const boundaryDate of boundaryDates) {
      // Close the open sub-period: value the (unchanged) holdings at this date.
      if (prevDate !== null && prevValue > 0) {
        const valueBefore = valueHoldings(holdings, boundaryDate);
        let dividendsInPeriod = 0;
        while (dividendIdx < dividends.length && dividends[dividendIdx]!.date <= boundaryDate) {
          if (dividends[dividendIdx]!.date > prevDate) dividendsInPeriod += dividends[dividendIdx]!.amount;
          dividendIdx += 1;
        }
        cumulativeFactor *= (valueBefore + dividendsInPeriod) / prevValue;
      }

      // Apply this date's trades to the running holdings. Cost-basis tracking
      // mirrors `recalculateHolding` / `get-combined-balance-history` so an
      // oversell (allowed for crypto) doesn't corrupt the basis used as the
      // no-price valuation fallback.
      for (const tx of tradesByDate.get(boundaryDate) ?? []) {
        const quantity = Number(tx.quantity);
        const totalAmount = Number(tx.refAmount);
        const holding = holdings.get(tx.securityId) ?? { quantity: 0, costBasis: 0 };

        if (tx.category === INVESTMENT_TRANSACTION_CATEGORY.buy) {
          const newQuantity = holding.quantity + quantity;
          if (newQuantity <= 0) {
            holding.costBasis = 0;
          } else if (holding.quantity <= 0) {
            // Buy crosses from short/zero into long — only the long part is new basis.
            holding.costBasis = totalAmount * (newQuantity / quantity);
          } else {
            holding.costBasis += totalAmount;
          }
          holding.quantity = newQuantity;
        } else {
          if (holding.quantity > 0) {
            const newQuantity = holding.quantity - quantity;
            holding.costBasis = newQuantity <= 0 ? 0 : holding.costBasis * (newQuantity / holding.quantity);
          }
          holding.quantity -= quantity;
        }

        holdings.set(tx.securityId, holding);
      }

      prevValue = valueHoldings(holdings, boundaryDate);
      prevDate = boundaryDate;
      if (prevValue > 0) started = true;
    }

    // `cumulativeFactor <= 0` means the position was wiped out — not annualizable.
    const computable = started && periodDays > 0 && cumulativeFactor > 0;
    const annualizedReturn = computable
      ? Math.round((Math.pow(cumulativeFactor, 365 / periodDays) - 1) * 100 * 100) / 100
      : null;

    results.push({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      annualizedReturn,
      hasEnoughHistory: annualizedReturn !== null,
      startDate,
      periodDays,
      currencyCode: baseCurrencyCode,
    });
  }

  if (missingRateCurrencies.size > 0) {
    logger.warn('Annualized return: exchange rate fallback to 1:1', {
      userId,
      baseCurrency: baseCurrencyCode,
      currencies: Array.from(missingRateCurrencies),
    });
  }

  return results;
};
