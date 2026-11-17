import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { format, subDays } from 'date-fns';

// getHoldingValues deduplicates identical requests for 1 second; the summary
// call must outwait it after the setup calls primed it.
const DEDUP_CACHE_MS = 1100;

const daysAgo = (days: number) => format(subDays(new Date(), days), 'yyyy-MM-dd');
const DEPOSIT_DATE = daysAgo(10);
const BUY_DATE = daysAgo(8);
const SELL_DATE = daysAgo(5);
const TODAY = daysAgo(0);

const seedTodayUsdRates = async ({ rates }: { rates: [string, number][] }) => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  for (const [quoteCode, rate] of rates) {
    await ExchangeRates.destroy({ where: { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, date } });
    await ExchangeRates.create({ baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, rate, date });
  }
};

/**
 * Deposit 2000, buy 10 @ 100, sell 4 @ 150, then price the security at 120
 * today. All in the base currency: cash 2000 → 1000 → 1600, cost basis
 * 1000 → 600, realized gain 0 → 200, holdings today 6 × 120 = 720.
 */
const seedPortfolio = async ({
  displayCurrencyCode,
  securityCurrencyCode = global.BASE_CURRENCY_CODE,
}: { displayCurrencyCode?: string; securityCurrencyCode?: string } = {}) => {
  const portfolio: Portfolios = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: 'Value History Portfolio' }),
    raw: true,
  });
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Value History Source' }),
    raw: true,
  });
  await helpers.accountToPortfolioTransfer({
    portfolioId: portfolio.id,
    payload: { accountId: account.id, amount: '2000', date: DEPOSIT_DATE },
    raw: true,
  });

  const security = await Securities.create({
    symbol: 'VHST',
    providerSymbol: 'VHST',
    currencyCode: securityCurrencyCode,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: 'Value History Test Security',
  });
  await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });

  await helpers.createInvestmentTransaction({
    payload: { portfolioId: portfolio.id, securityId: security.id, date: BUY_DATE, quantity: '10', price: '100' },
  });
  await helpers.createInvestmentTransaction({
    payload: {
      portfolioId: portfolio.id,
      securityId: security.id,
      category: INVESTMENT_TRANSACTION_CATEGORY.sell,
      date: SELL_DATE,
      quantity: '4',
      price: '150',
    },
  });

  // Drain the background price sync triggered by createHolding, then keep only
  // the price point we control.
  await helpers.sleep(200);
  await SecurityPricing.destroy({ where: { securityId: security.id } });
  await SecurityPricing.create({
    securityId: security.id,
    date: new Date(),
    priceClose: '120',
    source: SECURITY_PROVIDER.fmp,
  });

  if (displayCurrencyCode) {
    await helpers.addUserCurrencyByCode({ code: displayCurrencyCode, raw: true });
    await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode } });
  }

  return portfolio;
};

describe('Portfolio value history (GET /investments/portfolios/:id/value-history)', () => {
  it('replays daily values from the first event to today, ending at the summary', async () => {
    const portfolio = await seedPortfolio();
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    expect(history.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    expect(history.points).toHaveLength(11);
    expect(history.points[0]!.date).toBe(DEPOSIT_DATE);
    expect(history.points.at(-1)!.date).toBe(TODAY);

    for (const point of history.points) {
      expect(Number(point.totalValue)).toBeCloseTo(Number(point.holdingsValue) + Number(point.cashValue), 2);
    }

    const byDate = new Map(history.points.map((point) => [point.date, point]));
    expect(byDate.get(DEPOSIT_DATE)).toEqual({
      date: DEPOSIT_DATE,
      totalValue: '2000.00',
      holdingsValue: '0.00',
      cashValue: '2000.00',
      costBasis: '0.00',
      realizedGain: '0.00',
    });
    // Unpriced days carry the holding at cost basis.
    expect(byDate.get(BUY_DATE)).toMatchObject({
      totalValue: '2000.00',
      holdingsValue: '1000.00',
      cashValue: '1000.00',
      costBasis: '1000.00',
      realizedGain: '0.00',
    });
    expect(byDate.get(SELL_DATE)).toMatchObject({
      totalValue: '2200.00',
      holdingsValue: '600.00',
      cashValue: '1600.00',
      costBasis: '600.00',
      realizedGain: '200.00',
    });

    const today = byDate.get(TODAY)!;
    expect(today).toEqual({
      date: TODAY,
      totalValue: '2320.00',
      holdingsValue: '720.00',
      cashValue: '1600.00',
      costBasis: '600.00',
      realizedGain: '200.00',
    });
    expect(today.totalValue).toBe(summary.totalPortfolioValue);
    expect(today.holdingsValue).toBe(summary.totalCurrentValue);
    expect(today.cashValue).toBe(summary.totalCashInBaseCurrency);
    expect(today.costBasis).toBe(summary.totalCostBasis);
    expect(today.realizedGain).toBe(summary.realizedGainValue);
  });

  it('limits the points to the requested range', async () => {
    const portfolio = await seedPortfolio();

    const history = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: BUY_DATE,
      to: SELL_DATE,
      raw: true,
    });

    expect(history.points.map((point) => point.date)).toEqual([BUY_DATE, daysAgo(7), daysAgo(6), SELL_DATE]);
    expect(history.points[0]).toMatchObject({ cashValue: '1000.00', costBasis: '1000.00' });
  });

  it('reports values in the display currency, matching the summary today', async () => {
    const portfolio = await seedPortfolio({ displayCurrencyCode: 'EUR' });

    // The history converts at the latest stored daily rate, the summary at the
    // provider's live one; storing today's rates makes the two sources agree.
    await seedTodayUsdRates({
      rates: [
        [global.BASE_CURRENCY_CODE, AED_PER_USD],
        ['EUR', EUR_PER_USD],
      ],
    });
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    expect(history.currencyCode).toBe('EUR');
    expect(summary.currencyCode).toBe('EUR');
    const today = history.points.at(-1)!;
    expect(Number(today.totalValue)).toBeCloseTo(Number(summary.totalPortfolioValue), 1);
    expect(Number(today.holdingsValue)).toBeCloseTo(Number(summary.totalCurrentValue), 1);
    expect(Number(today.cashValue)).toBeCloseTo(Number(summary.totalCashInBaseCurrency), 1);
    expect(Number(today.costBasis)).toBeCloseTo(Number(summary.totalCostBasis), 1);
    expect(Number(today.realizedGain)).toBeCloseTo(Number(summary.realizedGainValue), 1);
  });

  it('converts a foreign-currency holding at the day rate, matching the summary today', async () => {
    const portfolio = await seedPortfolio({ securityCurrencyCode: 'USD' });
    await seedTodayUsdRates({ rates: [[global.BASE_CURRENCY_CODE, AED_PER_USD]] });
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    const today = history.points.at(-1)!;
    expect(Number(today.holdingsValue)).toBeCloseTo(720 * AED_PER_USD, 1);
    expect(Number(today.costBasis)).toBeCloseTo(600 * AED_PER_USD, 1);
    expect(Number(today.realizedGain)).toBeCloseTo(200 * AED_PER_USD, 1);
    expect(Number(today.holdingsValue)).toBeCloseTo(Number(summary.totalCurrentValue), 1);
    expect(Number(today.costBasis)).toBeCloseTo(Number(summary.totalCostBasis), 1);
    expect(Number(today.realizedGain)).toBeCloseTo(Number(summary.realizedGainValue), 1);
    expect(Number(today.cashValue)).toBeCloseTo(Number(summary.totalCashInBaseCurrency), 1);
  });

  it('falls back to the base currency when the display currency has no rate', async () => {
    // Neither the mocked providers nor the stored rates carry an SSP rate.
    const portfolio = await seedPortfolio({ displayCurrencyCode: 'SSP' });

    const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

    expect(history.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    expect(history.points.at(-1)).toMatchObject({ totalValue: '2320.00', costBasis: '600.00' });
  });

  it('starts at the first event when the requested range reaches further back', async () => {
    const portfolio = await seedPortfolio();

    const history = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: '2000-01-01',
      raw: true,
    });

    expect(history.points[0]!.date).toBe(DEPOSIT_DATE);
  });

  it('returns a single zero point for a portfolio with no activity', async () => {
    const portfolio: Portfolios = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Empty Value History' }),
      raw: true,
    });

    const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

    expect(history).toEqual({
      currencyCode: global.BASE_CURRENCY_CODE,
      points: [
        {
          date: TODAY,
          totalValue: '0.00',
          holdingsValue: '0.00',
          cashValue: '0.00',
          costBasis: '0.00',
          realizedGain: '0.00',
        },
      ],
    });
  });

  it("returns 404 for another user's portfolio", async () => {
    const portfolio = await seedPortfolio();

    const { cookies } = await helpers.signUpSecondUser();
    const response = await helpers.asUser({
      cookies,
      fn: () => helpers.getPortfolioValueHistory({ portfolioId: portfolio.id }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('returns 404 for a portfolio that does not exist', async () => {
    const response = await helpers.getPortfolioValueHistory({ portfolioId: '00000000-0000-4000-8000-000000000000' });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('rejects a range whose start is after its end', async () => {
    const portfolio: Portfolios = await helpers.createPortfolio({ raw: true });

    const response = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: TODAY,
      to: DEPOSIT_DATE,
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});
