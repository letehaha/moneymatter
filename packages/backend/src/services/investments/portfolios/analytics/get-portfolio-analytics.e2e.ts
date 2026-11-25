import {
  API_ERROR_CODES,
  ASSET_CLASS,
  FEATURES,
  INVESTMENT_TRANSACTION_CATEGORY,
  PLANS,
  PORTFOLIO_BENCHMARKS,
  PORTFOLIO_RETURN_PERIODS,
  type PortfolioBenchmark,
  type PortfolioReturnPeriod,
  SECURITY_PROVIDER,
  SECURITY_TYPE,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { format, subDays, subMonths, subYears } from 'date-fns';

// getHoldingValues deduplicates identical requests for 1 second; reads after
// re-seeding prices must outwait it.
const DEDUP_CACHE_MS = 1100;

const daysAgo = ({ days }: { days: number }) => format(subDays(new Date(), days), 'yyyy-MM-dd');
const TODAY = daysAgo({ days: 0 });

type SeededPrice = { days: number; price: number };

const createEmptyPortfolio = ({ name }: { name: string }): Promise<Portfolios> =>
  helpers.createPortfolio({ payload: helpers.buildPortfolioPayload({ name }), raw: true });

const deposit = ({ portfolioId, amount, days }: { portfolioId: string; amount: string; days: number }) =>
  helpers.directCashTransaction({
    portfolioId,
    payload: { type: 'deposit', amount, currencyCode: global.BASE_CURRENCY_CODE, date: daysAgo({ days }) },
    raw: true,
  });

const createSecurityHolding = async ({
  portfolioId,
  symbol,
  currencyCode = global.BASE_CURRENCY_CODE,
  securityType = null,
}: {
  portfolioId: string;
  symbol: string;
  currencyCode?: string;
  securityType?: SECURITY_TYPE | null;
}) => {
  const security = await Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    securityType,
    name: `${symbol} Test Security`,
  });
  await helpers.createHolding({ payload: { portfolioId, securityId: security.id } });
  return security;
};

const trade = ({
  portfolioId,
  securityId,
  category = INVESTMENT_TRANSACTION_CATEGORY.buy,
  days,
  quantity,
  price,
  fees,
}: {
  portfolioId: string;
  securityId: string;
  category?: INVESTMENT_TRANSACTION_CATEGORY;
  days: number;
  quantity: string;
  price: string;
  fees?: string;
}) =>
  helpers.createInvestmentTransaction({
    payload: { portfolioId, securityId, category, date: daysAgo({ days }), quantity, price, fees },
  });

/** Replaces whatever the background sync after createHolding stored with exactly these closes. */
const seedPrices = async ({ pricesBySecurity }: { pricesBySecurity: Map<string, SeededPrice[]> }) => {
  await helpers.sleep(200);
  for (const [securityId, prices] of pricesBySecurity) {
    await SecurityPricing.destroy({ where: { securityId } });
    for (const { days, price } of prices) {
      await SecurityPricing.create({
        securityId,
        date: new Date(`${daysAgo({ days })}T12:00:00.000Z`),
        priceClose: String(price),
        source: SECURITY_PROVIDER.fmp,
      });
    }
  }
  await helpers.sleep(DEDUP_CACHE_MS);
};

const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

const RETURN_ANCHORS: Record<PortfolioReturnPeriod, string> = {
  '1M': toDateKey(subMonths(new Date(), 1)),
  '3M': toDateKey(subMonths(new Date(), 3)),
  '6M': toDateKey(subMonths(new Date(), 6)),
  YTD: `${new Date().getFullYear() - 1}-12-31`,
  '1Y': toDateKey(subYears(new Date(), 1)),
};

/** Latest close over the latest close on or before the anchor, or null when none is that old. */
const expectedReturn = ({ prices, anchor }: { prices: SeededPrice[]; anchor: string }): number | null => {
  const sorted = prices.toSorted((a, b) => b.days - a.days);
  const base = sorted.filter(({ days }) => daysAgo({ days }) <= anchor).at(-1);
  return base ? sorted.at(-1)!.price / base.price - 1 : null;
};

const expectReturns = ({
  returns,
  prices,
}: {
  returns: Record<PortfolioReturnPeriod, string | null>;
  prices: SeededPrice[];
}) => {
  for (const period of PORTFOLIO_RETURN_PERIODS) {
    const expected = expectedReturn({ prices, anchor: RETURN_ANCHORS[period] });
    if (expected === null) {
      expect({ period, value: returns[period] }).toEqual({ period, value: null });
    } else {
      expect({ period, value: Number(returns[period]) }).toEqual({ period, value: expect.closeTo(expected, 6) });
    }
  }
};

const sumOf = ({ values }: { values: string[] }) => values.reduce((total, value) => total + Number(value), 0);

/** Peak 120 on day -45, trough 90 on day -35, back above the peak at 130 on day -20. */
const ALPHA_PRICES: SeededPrice[] = [
  { days: 400, price: 50 },
  { days: 200, price: 80 },
  { days: 100, price: 90 },
  { days: 50, price: 100 },
  { days: 45, price: 120 },
  { days: 35, price: 90 },
  { days: 20, price: 130 },
  { days: 0, price: 130 },
];
const BETA_PRICES: SeededPrice[] = [
  { days: 60, price: 20 },
  { days: 0, price: 25 },
];

/**
 * Deposit 3000 and buy 10 ALPHA @ 100 on day -50, buy 20 BETA @ 20 on day -15,
 * 20 of ALPHA dividends on day -10. Today: ALPHA 1300, BETA 500, cash 1620,
 * total 3420. No flow after day -50, so the TWR is 3420 / 3000 − 1.
 */
const seedAnalyticsPortfolio = async () => {
  const portfolio = await createEmptyPortfolio({ name: 'Analytics Portfolio' });
  await deposit({ portfolioId: portfolio.id, amount: '3000', days: 50 });

  const alpha = await createSecurityHolding({
    portfolioId: portfolio.id,
    symbol: 'ALPHA',
    securityType: SECURITY_TYPE.stock,
  });
  const beta = await createSecurityHolding({
    portfolioId: portfolio.id,
    symbol: 'BETA',
    securityType: SECURITY_TYPE.etf,
  });
  await trade({ portfolioId: portfolio.id, securityId: alpha.id, days: 50, quantity: '10', price: '100' });
  await trade({ portfolioId: portfolio.id, securityId: beta.id, days: 15, quantity: '20', price: '20' });
  await trade({
    portfolioId: portfolio.id,
    securityId: alpha.id,
    category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
    days: 10,
    quantity: '10',
    price: '2',
  });

  await seedPrices({
    pricesBySecurity: new Map([
      [alpha.id, ALPHA_PRICES],
      [beta.id, BETA_PRICES],
    ]),
  });

  return { portfolio, alpha, beta };
};

/** Sets the USD → `quoteCode` rate on the given days; returns a cleanup, as rates outlive the test. */
const seedUsdRates = async ({ rates }: { rates: { quoteCode: string; days: number; rate: number }[] }) => {
  const rows = rates.map(({ quoteCode, days, rate }) => ({
    baseCode: API_LAYER_BASE_CURRENCY_CODE,
    quoteCode,
    rate,
    date: new Date(`${daysAgo({ days })}T00:00:00.000Z`),
  }));
  for (const row of rows) {
    await ExchangeRates.destroy({ where: { baseCode: row.baseCode, quoteCode: row.quoteCode, date: row.date } });
    await ExchangeRates.create(row);
  }
  return () =>
    Promise.all(
      rows.map(({ baseCode, quoteCode, date }) => ExchangeRates.destroy({ where: { baseCode, quoteCode, date } })),
    );
};

/**
 * Buys, sells, dividends and a fee row across days -50 to -5, in the base currency:
 * - day -50: buy 10 ALPHA @ 100, fee 5
 * - day -45: ALPHA dividend 10
 * - day -30: buy 10 ALPHA @ 100, fee 3; buy 20 BETA @ 10, fee 1
 * - day -20: sell 5 ALPHA @ 110, fee 2
 * - day -10: ALPHA dividend 20 less a fee of 1; BETA dividend 20
 * - day -5: a fee row of 4
 */
const seedFeesPortfolio = async () => {
  const portfolio = await createEmptyPortfolio({ name: 'Fees Portfolio' });
  await deposit({ portfolioId: portfolio.id, amount: '10000', days: 60 });
  const alpha = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'ALPHA' });
  const beta = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'BETA' });
  const { dividend, sell, fee } = INVESTMENT_TRANSACTION_CATEGORY;
  const portfolioId = portfolio.id;

  await trade({ portfolioId, securityId: alpha.id, days: 50, quantity: '10', price: '100', fees: '5' });
  await trade({ portfolioId, securityId: alpha.id, category: dividend, days: 45, quantity: '10', price: '1' });
  await trade({ portfolioId, securityId: alpha.id, days: 30, quantity: '10', price: '100', fees: '3' });
  await trade({ portfolioId, securityId: beta.id, days: 30, quantity: '20', price: '10', fees: '1' });
  await trade({ portfolioId, securityId: alpha.id, category: sell, days: 20, quantity: '5', price: '110', fees: '2' });
  await trade({
    portfolioId,
    securityId: alpha.id,
    category: dividend,
    days: 10,
    quantity: '10',
    price: '2',
    fees: '1',
  });
  await trade({ portfolioId, securityId: beta.id, category: dividend, days: 10, quantity: '20', price: '1' });
  await trade({ portfolioId, securityId: alpha.id, category: fee, days: 5, quantity: '1', price: '4' });

  return { portfolio, alpha, beta };
};

const seedBenchmark = async ({ benchmark, prices }: { benchmark: PortfolioBenchmark; prices: SeededPrice[] }) => {
  const { providerSymbol, currencyCode, name } = PORTFOLIO_BENCHMARKS[benchmark];
  const security = await Securities.create({
    symbol: providerSymbol,
    providerSymbol,
    currencyCode,
    name,
    providerName: SECURITY_PROVIDER.yahoo,
    assetClass: ASSET_CLASS.stocks,
    securityType: SECURITY_TYPE.other,
  });
  for (const { days, price } of prices) {
    await SecurityPricing.create({
      securityId: security.id,
      date: new Date(`${daysAgo({ days })}T12:00:00.000Z`),
      priceClose: String(price),
      source: SECURITY_PROVIDER.yahoo,
    });
  }
  return security;
};

/** The latest seeded close on or before `date`, or null. */
const closeOn = ({ prices, date }: { prices: SeededPrice[]; date: string }) =>
  prices
    .filter(({ days }) => daysAgo({ days }) <= date)
    .toSorted((a, b) => a.days - b.days)
    .at(0)?.price ?? null;

describe('Portfolio analytics (GET /investments/portfolios/:id/analytics)', () => {
  describe('access', () => {
    it.each([
      { label: 'an Essential plan', plan: PLANS.essential },
      { label: 'an early adopter plan', plan: PLANS.early_adopter },
    ])('returns 402 planRequired for $label', async ({ plan }) => {
      const portfolio = await createEmptyPortfolio({ name: 'Gated' });
      await helpers.setUserBilling({ plan });

      const response = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id });

      expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
    });

    it('returns 200 for a Plus plan', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Plus' });
      await helpers.setUserBilling({ plan: PLANS.plus });

      const response = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id });

      expect(response.statusCode).toBe(200);
    });

    it('returns 200 for an Essential user once the portfolio analytics trial is started', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Trial' });
      await helpers.setUserBilling({ plan: PLANS.essential });

      const trial = await helpers.startFeatureTrial({ feature: FEATURES.portfolio_analytics });
      expect(trial.statusCode).toBe(200);

      const response = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id });

      expect(response.statusCode).toBe(200);
    });

    it("returns 404 for another user's portfolio", async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Private' });

      const { cookies } = await helpers.signUpSecondUser();
      const response = await helpers.asUser({
        cookies,
        fn: () => helpers.getPortfolioAnalytics({ portfolioId: portfolio.id }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('rejects a range whose start is after its end', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Bad Range' });

      const response = await helpers.getPortfolioAnalytics({
        portfolioId: portfolio.id,
        from: TODAY,
        to: daysAgo({ days: 10 }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects an unknown benchmark', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Bad Benchmark' });

      const response = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, benchmark: 'ftse100' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  it('returns zeros, nulls and empty lists for a portfolio with no activity', async () => {
    const portfolio = await createEmptyPortfolio({ name: 'Empty Analytics' });

    const analytics = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

    expect(analytics).toEqual({
      currencyCode: global.BASE_CURRENCY_CODE,
      kpis: {
        moneyWeightedReturn: null,
        timeWeightedReturn: expect.toBeNumericEqual(0),
        maxDrawdown: null,
        feesPaid: { amount: '0.00', shareOfBuys: null },
      },
      monthlyMarketGain: [],
      holdings: [],
      portfolioReturnSeries: [],
      allocation: { byHolding: [], bySecurityType: [], byCurrency: [] },
    });
  });

  describe('happy path', () => {
    it('reports holdings with their values, weights and price returns', async () => {
      const { portfolio, alpha, beta } = await seedAnalyticsPortfolio();

      const analytics = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(analytics.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(analytics.holdings.map((holding) => holding.securityId)).toEqual([alpha.id, beta.id]);

      const [alphaHolding, betaHolding] = analytics.holdings;
      expect(alphaHolding).toMatchObject({
        symbol: 'ALPHA',
        name: 'ALPHA Test Security',
        currencyCode: global.BASE_CURRENCY_CODE,
        value: '1300.00',
      });
      expect(Number(alphaHolding!.weight)).toBeCloseTo(1300 / 3420, 6);
      expect(betaHolding).toMatchObject({ symbol: 'BETA', value: '500.00' });
      expect(Number(betaHolding!.weight)).toBeCloseTo(500 / 3420, 6);

      expectReturns({ returns: alphaHolding!.returns, prices: ALPHA_PRICES });
      expectReturns({ returns: betaHolding!.returns, prices: BETA_PRICES });
      // BETA's closes start 60 days back, so the 3M, 6M and 1Y anchors have nothing to compare against.
      expect(betaHolding!.returns['3M']).toBeNull();
      expect(betaHolding!.returns['1Y']).toBeNull();
    });

    it('splits the allocation by holding, security type and currency, cash included', async () => {
      const { portfolio, alpha, beta } = await seedAnalyticsPortfolio();

      const { allocation } = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      for (const entries of [allocation.byHolding, allocation.bySecurityType, allocation.byCurrency]) {
        expect(sumOf({ values: entries.map((entry) => entry.weight) })).toBeCloseTo(1, 6);
        expect(sumOf({ values: entries.map((entry) => entry.value) })).toBeCloseTo(3420, 2);
      }

      expect(allocation.byHolding).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: alpha.id, label: 'ALPHA', value: '1300.00' }),
          expect.objectContaining({ key: beta.id, label: 'BETA', value: '500.00' }),
          expect.objectContaining({ key: 'cash', value: '1620.00' }),
        ]),
      );
      expect(allocation.bySecurityType).toEqual([
        expect.objectContaining({ key: 'cash', value: '1620.00' }),
        expect.objectContaining({ key: SECURITY_TYPE.stock, value: '1300.00' }),
        expect.objectContaining({ key: SECURITY_TYPE.etf, value: '500.00' }),
      ]);
      expect(allocation.byCurrency).toEqual([
        expect.objectContaining({ key: global.BASE_CURRENCY_CODE, value: '3420.00' }),
      ]);
    });

    it('reports the KPIs: TWR, max drawdown with recovery and no MWR under 180 days', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();

      const { kpis } = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(Number(kpis.timeWeightedReturn)).toBeCloseTo(3420 / 3000 - 1, 6);
      expect(kpis.moneyWeightedReturn).toBeNull();

      expect(kpis.maxDrawdown).toMatchObject({
        peakDate: daysAgo({ days: 45 }),
        troughDate: daysAgo({ days: 35 }),
        recoveredDate: daysAgo({ days: 20 }),
      });
      expect(Number(kpis.maxDrawdown!.value)).toBeCloseTo(2900 / 3200 - 1, 6);
    });

    it('matches the value history: monthly gains, TWR over a window, and the return series', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      const from = daysAgo({ days: 40 });

      const [analytics, history, rangedAnalytics, rangedHistory] = await Promise.all([
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, from, raw: true }),
        helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, from, raw: true }),
      ]);

      const lastPoint = history.points.at(-1)!;
      const months = [...new Set(history.points.map((point) => point.date.slice(0, 7)))];
      expect(analytics.monthlyMarketGain.map((entry) => entry.month)).toEqual(months);
      expect(sumOf({ values: analytics.monthlyMarketGain.map((entry) => entry.gain) })).toBeCloseTo(
        Number(lastPoint.totalValue) - Number(lastPoint.netDeposits),
        2,
      );

      expect(Number(analytics.kpis.timeWeightedReturn)).toBeCloseTo(Number(lastPoint.timeWeightedReturn), 6);
      expect(Number(rangedAnalytics.kpis.timeWeightedReturn)).toBeCloseTo(
        Number(rangedHistory.points.at(-1)!.timeWeightedReturn),
        6,
      );

      const rangedFirst = rangedHistory.points[0]!;
      const rangedLast = rangedHistory.points.at(-1)!;
      expect(sumOf({ values: rangedAnalytics.monthlyMarketGain.map((entry) => entry.gain) })).toBeCloseTo(
        Number(rangedLast.totalValue) -
          Number(rangedFirst.totalValue) -
          (Number(rangedLast.netDeposits) - Number(rangedFirst.netDeposits)),
        2,
      );

      const returnSeries = analytics.portfolioReturnSeries;
      expect(returnSeries.map((point) => point.date)).toEqual(history.points.map((point) => point.date));
      expect(Number(returnSeries[0]!.value)).toBeCloseTo(0, 6);
      expect(Number(returnSeries.at(-1)!.value)).toBeCloseTo(Number(lastPoint.timeWeightedReturn), 6);

      const rangedSeries = rangedAnalytics.portfolioReturnSeries;
      expect(rangedSeries.map((point) => point.date)).toEqual(rangedHistory.points.map((point) => point.date));
      expect(Number(rangedSeries[0]!.value)).toBeCloseTo(0, 6);
      expect(Number(rangedSeries.at(-1)!.value)).toBeCloseTo(Number(rangedAnalytics.kpis.timeWeightedReturn), 6);
    });

    it('values a holding without any stored price at its cost basis, as the value history does', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Unpriced' });
      await deposit({ portfolioId: portfolio.id, amount: '1000', days: 10 });
      const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'NOPRICE' });
      await trade({ portfolioId: portfolio.id, securityId: security.id, days: 10, quantity: '5', price: '100' });
      await seedPrices({ pricesBySecurity: new Map([[security.id, []]]) });

      const [analytics, history] = await Promise.all([
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      ]);

      expect(history.points.at(-1)).toMatchObject({ holdingsValue: '500.00' });
      expect(analytics.holdings[0]).toMatchObject({ securityId: security.id, value: '500.00' });
      expect(analytics.allocation.byHolding).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: security.id, value: '500.00' })]),
      );
      expect(analytics.allocation.bySecurityType).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: SECURITY_TYPE.other, value: '500.00' })]),
      );
    });

    it('reports a non-base display currency, converting a foreign holding and cash', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Display Currency' });
      await deposit({ portfolioId: portfolio.id, amount: '5000', days: 30 });
      const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'USDX', currencyCode: 'USD' });
      await trade({ portfolioId: portfolio.id, securityId: security.id, days: 30, quantity: '10', price: '100' });
      await trade({
        portfolioId: portfolio.id,
        securityId: security.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
        days: 10,
        quantity: '10',
        price: '2',
      });
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });
      const today = new Date(`${TODAY}T00:00:00.000Z`);
      for (const [quoteCode, rate] of [
        [global.BASE_CURRENCY_CODE, AED_PER_USD],
        ['EUR', EUR_PER_USD],
      ] as const) {
        await ExchangeRates.destroy({ where: { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, date: today } });
        await ExchangeRates.create({ baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, rate, date: today });
      }
      await seedPrices({
        pricesBySecurity: new Map([
          [
            security.id,
            [
              { days: 30, price: 100 },
              { days: 0, price: 120 },
            ],
          ],
        ]),
      });

      const [analytics, history] = await Promise.all([
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      ]);

      expect(analytics.currencyCode).toBe('EUR');
      expect(history.currencyCode).toBe('EUR');
      const last = history.points.at(-1)!;
      expect(Number(analytics.holdings[0]!.value)).toBeCloseTo(1200 * EUR_PER_USD, 0);
      expect(Number(analytics.holdings[0]!.value)).toBeCloseTo(Number(last.holdingsValue), 0);
      expect(sumOf({ values: analytics.allocation.byCurrency.map((entry) => entry.value) })).toBeCloseTo(
        Number(last.totalValue),
        0,
      );
    });

    it('reports the base currency when the display currency has no rate', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      await helpers.addUserCurrencyByCode({ code: 'SSP', raw: true });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'SSP' } });

      const analytics = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(analytics.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(analytics.holdings.map((holding) => holding.value)).toEqual(['1300.00', '500.00']);
    });

    it('rebases a window that starts after the last day or before the first one', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();

      const [full, beforeFirst, afterLast] = await Promise.all([
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, from: daysAgo({ days: 400 }), raw: true }),
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, from: daysAgo({ days: -5 }), raw: true }),
      ]);

      expect(beforeFirst.kpis.timeWeightedReturn).toBe(full.kpis.timeWeightedReturn);
      expect(beforeFirst.portfolioReturnSeries).toEqual(full.portfolioReturnSeries);
      expect(Number(afterLast.kpis.timeWeightedReturn)).toBe(0);
      expect(afterLast.kpis.maxDrawdown).toBeNull();
      expect(afterLast.portfolioReturnSeries).toEqual([{ date: TODAY, value: expect.toBeNumericEqual(0) }]);
      expect(afterLast.monthlyMarketGain).toEqual([{ month: TODAY.slice(0, 7), gain: '0.00' }]);
    });

    it('orders holdings by value and leaves closed positions out', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Many Holdings' });
      await deposit({ portfolioId: portfolio.id, amount: '10000', days: 20 });
      const symbols = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      const securities: Securities[] = [];
      for (const [index, symbol] of symbols.entries()) {
        const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol });
        await trade({
          portfolioId: portfolio.id,
          securityId: security.id,
          days: 20,
          quantity: String(index + 1),
          price: '100',
        });
        securities.push(security);
      }
      const closed = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'GONE' });
      await trade({ portfolioId: portfolio.id, securityId: closed.id, days: 20, quantity: '5', price: '100' });
      await trade({
        portfolioId: portfolio.id,
        securityId: closed.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.sell,
        days: 10,
        quantity: '5',
        price: '100',
      });
      await seedPrices({
        pricesBySecurity: new Map(
          [...securities, closed].map((security) => [
            security.id,
            [
              { days: 20, price: 100 },
              { days: 0, price: 100 },
            ],
          ]),
        ),
      });

      const analytics = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(analytics.holdings.map((holding) => holding.symbol)).toEqual(symbols.toReversed());
      expect(analytics.allocation.byHolding.map((entry) => entry.key)).not.toContain(closed.id);
    });

    it('leaves negative cash out of the weights and the allocation', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Negative Cash' });
      const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'NOCASH' });
      await trade({ portfolioId: portfolio.id, securityId: security.id, days: 10, quantity: '5', price: '100' });
      await seedPrices({
        pricesBySecurity: new Map([
          [
            security.id,
            [
              { days: 10, price: 100 },
              { days: 0, price: 120 },
            ],
          ],
        ]),
      });

      const { holdings, allocation } = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(holdings).toHaveLength(1);
      for (const { weight } of holdings) {
        expect(Number(weight)).toBeGreaterThan(0);
        expect(Number(weight)).toBeLessThanOrEqual(1);
      }
      expect(sumOf({ values: holdings.map((holding) => holding.weight) })).toBeLessThanOrEqual(1 + 1e-9);
      for (const entry of [...allocation.byHolding, ...allocation.bySecurityType, ...allocation.byCurrency]) {
        expect(Number(entry.value)).toBeGreaterThanOrEqual(0);
      }
      expect(allocation.byHolding.map((entry) => entry.key)).not.toContain('cash');
    });

    it('computes an annualized money-weighted return once the history spans 180 days', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Long History' });
      await deposit({ portfolioId: portfolio.id, amount: '1000', days: 400 });
      const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'LONG' });
      await trade({ portfolioId: portfolio.id, securityId: security.id, days: 400, quantity: '10', price: '100' });
      await seedPrices({
        pricesBySecurity: new Map([
          [
            security.id,
            [
              { days: 400, price: 100 },
              { days: 0, price: 110 },
            ],
          ],
        ]),
      });

      const { kpis } = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      // One outflow of 1000 and a terminal value of 1100, 400 days apart.
      expect(Number(kpis.moneyWeightedReturn)).toBeCloseTo(1.1 ** (365 / 400) - 1, 3);
    });
  });
  describe('fees', () => {
    it('sums the fees and the buys of the window, a fee row counted once', async () => {
      const { portfolio } = await seedFeesPortfolio();

      const [full, windowed, noBuys] = await Promise.all([
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true }),
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, from: daysAgo({ days: 40 }), raw: true }),
        helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, from: daysAgo({ days: 15 }), raw: true }),
      ]);

      expect(full.kpis.feesPaid.amount).toBe('16.00');
      expect(Number(full.kpis.feesPaid.shareOfBuys)).toBeCloseTo(16 / (1005 + 1003 + 201), 8);
      expect(windowed.kpis.feesPaid.amount).toBe('11.00');
      expect(Number(windowed.kpis.feesPaid.shareOfBuys)).toBeCloseTo(11 / (1003 + 201), 8);
      expect(noBuys.kpis.feesPaid).toEqual({ amount: '5.00', shareOfBuys: null });
    });

    it("converts fees into the display currency at each transaction day's rate", async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Display Fees' });
      await deposit({ portfolioId: portfolio.id, amount: '5000', days: 40 });
      const security = await createSecurityHolding({ portfolioId: portfolio.id, symbol: 'INCOME' });
      await trade({ portfolioId: portfolio.id, securityId: security.id, days: 40, quantity: '10', price: '100' });
      for (const days of [30, 1]) {
        await trade({
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
          days,
          quantity: '10',
          price: '2',
          fees: '1',
        });
      }
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });
      const cleanupRates = await seedUsdRates({
        rates: [
          { quoteCode: 'EUR', days: 30, rate: 0.8 },
          { quoteCode: 'EUR', days: 1, rate: 1 },
          { quoteCode: global.BASE_CURRENCY_CODE, days: 30, rate: AED_PER_USD },
          { quoteCode: global.BASE_CURRENCY_CODE, days: 1, rate: AED_PER_USD },
        ],
      });

      try {
        const { currencyCode, kpis } = await helpers.getPortfolioAnalytics({
          portfolioId: portfolio.id,
          raw: true,
        });

        expect(currencyCode).toBe('EUR');
        const day30 = 0.8 / AED_PER_USD;
        const day1 = 1 / AED_PER_USD;
        expect(Number(kpis.feesPaid.amount)).toBeCloseTo(day30 + day1, 2);
      } finally {
        await cleanupRates();
      }
    });
  });

  describe('benchmark', () => {
    // ExchangeRates outlives truncation, so rows left by earlier suites in the worker would
    // vary the USD benchmark's conversion day to day. One old row pins it for the whole window.
    const usdToBaseWhere = { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: global.BASE_CURRENCY_CODE };
    let storedRates: Pick<ExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate' | 'source'>[] = [];

    beforeEach(async () => {
      storedRates = (await ExchangeRates.findAll({ where: usdToBaseWhere, raw: true })).map(
        ({ baseCode, quoteCode, date, rate, source }) => ({ baseCode, quoteCode, date, rate, source }),
      );
      await ExchangeRates.destroy({ where: usdToBaseWhere });
      await ExchangeRates.create({
        ...usdToBaseWhere,
        rate: AED_PER_USD,
        date: new Date(`${daysAgo({ days: 400 })}T00:00:00.000Z`),
      });
    });

    afterEach(async () => {
      await ExchangeRates.destroy({ where: usdToBaseWhere });
      await ExchangeRates.bulkCreate(storedRates, { ignoreDuplicates: true });
    });

    const SP500_PRICES: SeededPrice[] = [
      { days: 60, price: 100 },
      { days: 30, price: 120 },
      { days: 0, price: 90 },
    ];

    it('leaves the benchmark out unless one is requested', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();

      const analytics = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, raw: true });

      expect(analytics).not.toHaveProperty('benchmark');
    });

    it('follows the benchmark closes from the portfolio series start, on the same dates', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      await seedBenchmark({ benchmark: 'sp500', prices: SP500_PRICES });

      const analytics = await helpers.getPortfolioAnalytics({
        portfolioId: portfolio.id,
        benchmark: 'sp500',
        raw: true,
      });

      const { portfolioReturnSeries, benchmark } = analytics;
      expect(benchmark?.key).toBe('sp500');
      const series = benchmark!.series;
      expect(series.map((point) => point.date)).toEqual(portfolioReturnSeries.map((point) => point.date));
      expect(series[0]!.value).toBe(portfolioReturnSeries[0]!.value);
      const startClose = closeOn({ prices: SP500_PRICES, date: series[0]!.date })!;
      for (const { date, value } of series) {
        expect({ date, value: Number(value) }).toEqual({
          date,
          value: expect.closeTo(closeOn({ prices: SP500_PRICES, date })! / startClose - 1, 6),
        });
      }
    });

    it('joins the portfolio line on the first close of a shorter history', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      const prices: SeededPrice[] = [
        { days: 30, price: 200 },
        { days: 10, price: 220 },
      ];
      await seedBenchmark({ benchmark: 'nasdaq100', prices });

      const { portfolioReturnSeries, benchmark } = await helpers.getPortfolioAnalytics({
        portfolioId: portfolio.id,
        benchmark: 'nasdaq100',
        raw: true,
      });

      const startDate = daysAgo({ days: 30 });
      const portfolioAtStart = Number(portfolioReturnSeries.find((point) => point.date === startDate)!.value);
      expect(portfolioAtStart).not.toBeCloseTo(0, 4);
      const series = benchmark!.series;
      expect(series.map((point) => point.date)).toEqual(
        portfolioReturnSeries.map((point) => point.date).filter((date) => date >= startDate),
      );
      expect(Number(series[0]!.value)).toBeCloseTo(portfolioAtStart, 8);
      expect(Number(series.at(-1)!.value)).toBeCloseTo((1 + portfolioAtStart) * (220 / 200) - 1, 6);
    });

    it("converts the benchmark into the analytics currency at each day's rate", async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      await seedBenchmark({
        benchmark: 'msci_world',
        prices: [
          { days: 30, price: 100 },
          { days: 1, price: 110 },
        ],
      });
      const cleanupRates = await seedUsdRates({
        rates: [
          { quoteCode: 'EUR', days: 30, rate: 0.8 },
          { quoteCode: 'EUR', days: 1, rate: 1 },
          { quoteCode: global.BASE_CURRENCY_CODE, days: 30, rate: AED_PER_USD },
          { quoteCode: global.BASE_CURRENCY_CODE, days: 1, rate: AED_PER_USD },
        ],
      });

      try {
        const { currencyCode, portfolioReturnSeries, benchmark } = await helpers.getPortfolioAnalytics({
          portfolioId: portfolio.id,
          benchmark: 'msci_world',
          raw: true,
        });

        expect(currencyCode).toBe(global.BASE_CURRENCY_CODE);
        const startDate = daysAgo({ days: 30 });
        const portfolioAtStart = Number(portfolioReturnSeries.find((point) => point.date === startDate)!.value);
        const series = benchmark!.series;
        expect(series[0]!.date).toBe(startDate);
        const dayOne = series.find((point) => point.date === daysAgo({ days: 1 }))!;
        // 100 EUR at 0.8 EUR per USD against 110 EUR at 1 EUR per USD: the price gain is an AED loss.
        expect(Number(dayOne.value)).toBeCloseTo((1 + portfolioAtStart) * (110 / 1 / (100 / 0.8)) - 1, 6);
      } finally {
        await cleanupRates();
      }
    });

    it('returns an empty series for a benchmark without prices', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      await seedBenchmark({ benchmark: 'sp500', prices: [] });

      const { benchmark } = await helpers.getPortfolioAnalytics({
        portfolioId: portfolio.id,
        benchmark: 'sp500',
        raw: true,
      });

      expect(benchmark).toEqual({ key: 'sp500', series: [] });
    });

    it('creates a missing benchmark security and still answers when its backfill fails', async () => {
      const { portfolio } = await seedAnalyticsPortfolio();
      const { providerSymbol, name, currencyCode } = PORTFOLIO_BENCHMARKS.euro_stoxx_50;
      expect(await Securities.count({ where: { providerSymbol } })).toBe(0);

      const response = await helpers.getPortfolioAnalytics({ portfolioId: portfolio.id, benchmark: 'euro_stoxx_50' });

      expect(response.statusCode).toBe(200);
      expect(helpers.extractResponse(response).benchmark).toEqual({ key: 'euro_stoxx_50', series: [] });
      const created = await Securities.findAll({ where: { providerSymbol }, raw: true });
      expect(created).toEqual([
        expect.objectContaining({
          symbol: providerSymbol,
          name,
          currencyCode,
          providerName: SECURITY_PROVIDER.yahoo,
          assetClass: ASSET_CLASS.stocks,
          securityType: SECURITY_TYPE.etf,
          isBrokerageCash: false,
        }),
      ]);
    });
  });
});
