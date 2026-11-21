import { API_ERROR_CODES, ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UsersCurrencies from '@models/users-currencies.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';
// USD-based rates served by the mocked rates provider for on-demand date
// lookups. The user's base currency is global.BASE_CURRENCY_CODE (AED), so the
// base→EUR conversion rate is EUR_PER_USD / AED_PER_USD via the USD pivot.
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';

// getHoldingValues deduplicates identical requests for 1 second; a summary
// request must outwait that window when earlier setup calls may have primed
// the cache with stale holding values.
const DEDUP_CACHE_MS = 1100;

const BUY_DATE = '2024-03-15';
const BUY_DATE_RATE_DATE = new Date(`${BUY_DATE}T00:00:00.000Z`);
// The whole point of the fixture: USD buys 8 base units on the trade date but
// only ~3.67 today, so a cost basis frozen at the trade-date rate and one
// converted at today's rate land far apart: on opposite sides of zero.
const BUY_DATE_USD_TO_BASE = 8;
const TODAY_USD_TO_BASE = AED_PER_USD;

const seedHoldingWithHistoricalBuy = async ({
  currencyCode,
  symbol,
  portfolio: existingPortfolio,
}: {
  currencyCode: string;
  symbol: string;
  portfolio?: Portfolios;
}) => {
  const portfolio =
    existingPortfolio ??
    (await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: `FX Gains Portfolio ${symbol}` }),
      raw: true,
    }));

  const security = await Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: `FX Gains Test Security ${symbol}`,
  });

  await helpers.createHolding({
    payload: { portfolioId: portfolio.id, securityId: security.id },
  });

  // Fund the trade in the holding's own currency so the buy leaves the
  // portfolio at exactly zero cash and the summary reports holdings only.
  await helpers.updatePortfolioBalance({
    portfolioId: portfolio.id,
    currencyCode,
    setAvailableCash: '1000',
    setTotalCash: '1000',
  });

  await helpers.createInvestmentTransaction({
    payload: {
      portfolioId: portfolio.id,
      securityId: security.id,
      date: BUY_DATE,
      quantity: '10',
      price: '100',
      fees: '0',
    },
  });

  // Drain the background price sync triggered by createHolding, then replace
  // the pricing rows with exactly the point we control.
  await helpers.sleep(200);
  await SecurityPricing.destroy({ where: { securityId: security.id } });
  await SecurityPricing.create({
    securityId: security.id,
    date: new Date(),
    priceClose: '120',
    source: SECURITY_PROVIDER.fmp,
  });

  return { portfolio, security };
};

describe('Portfolio Summary (GET /investments/portfolios/:id/summary)', () => {
  describe('Cash', () => {
    let portfolio: Portfolios;

    beforeEach(async () => {
      portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Summary Test Portfolio' }),
        raw: true,
      });
    });

    it('should report zero cash before any deposit, then include the deposited cash in the portfolio value', async () => {
      const emptySummary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(emptySummary.totalCashInBaseCurrency).toBe('0.00');
      expect(emptySummary.availableCashInBaseCurrency).toBe('0.00');
      expect(emptySummary.totalPortfolioValue).toBe('0.00');

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Cash Source' }),
        raw: true,
      });

      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '5000',
          date: '2025-06-15',
        },
        raw: true,
      });

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(parseFloat(summary.totalCashInBaseCurrency)).toBeGreaterThan(0);
      expect(parseFloat(summary.availableCashInBaseCurrency)).toBeGreaterThan(0);
      expect(parseFloat(summary.totalPortfolioValue)).toBeGreaterThan(0);

      expect(summary.totalCurrentValue).toBe('0.00');
      expect(parseFloat(summary.totalPortfolioValue)).toEqual(parseFloat(summary.totalCashInBaseCurrency));
    }, 30000);

    it('should aggregate multiple currency cash balances in summary', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'USD Source' }),
        raw: true,
      });

      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '3000',
          date: '2025-06-15',
        },
        raw: true,
      });

      const { account: eurAccount } = await helpers.createAccountWithNewCurrency({ currency: 'EUR' });

      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: eurAccount.id,
          amount: '2000',
          date: '2025-06-15',
        },
        raw: true,
      });

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(parseFloat(summary.totalCashInBaseCurrency)).toBeGreaterThan(0);
      expect(parseFloat(summary.totalPortfolioValue)).toBeGreaterThan(0);

      // Total cash should include both currencies (each converted to base)
      // so it should exceed the USD deposit alone
      expect(parseFloat(summary.totalCashInBaseCurrency)).toBeGreaterThan(3000);
    });
  });

  describe('Display currency', () => {
    let portfolio: Portfolios;

    beforeEach(async () => {
      portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Display Currency Portfolio' }),
        raw: true,
      });

      // Deposit 1000 in the user's base currency so ref values are exactly 1000
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Cash Source' }),
        raw: true,
      });

      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '1000',
          date: '2025-06-15',
        },
        raw: true,
      });
    });

    it('returns base currency when no display currency is set', async () => {
      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(summary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(summary.totalCashInBaseCurrency).toBe('1000.00');
      expect(summary.totalPortfolioValue).toBe('1000.00');
      expect(summary.baseCurrencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(summary.totalPortfolioValueInBaseCurrency).toBe('1000.00');
    });

    it('converts summary values to the display currency at the current rate', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });

      const updateResponse = await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: 'EUR' },
      });
      expect(updateResponse.statusCode).toBe(200);

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      const expected = (1000 * EUR_PER_USD) / AED_PER_USD;

      expect(summary.currencyCode).toBe('EUR');
      expect(parseFloat(summary.totalCashInBaseCurrency)).toBeCloseTo(expected, 1);
      expect(parseFloat(summary.availableCashInBaseCurrency)).toBeCloseTo(expected, 1);
      expect(parseFloat(summary.totalPortfolioValue)).toBeCloseTo(expected, 1);
      // Base-currency equivalent stays unconverted for the "~X base" UI line
      expect(summary.baseCurrencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(summary.totalPortfolioValueInBaseCurrency).toBe('1000.00');
    });

    it('converts holdings aggregates and total portfolio value to the display currency', async () => {
      // Security denominated in the base currency so the FX-free numbers are
      // deterministic: costBasis 1000, marketValue 1100, unrealized gain 100.
      const security = await Securities.create({
        symbol: 'SMRY',
        providerSymbol: 'SMRY',
        currencyCode: global.BASE_CURRENCY_CODE,
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Summary Display Currency Test Security',
      });

      await helpers.createHolding({
        payload: { portfolioId: portfolio.id, securityId: security.id },
      });

      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          quantity: '10',
          price: '100',
          fees: '0',
        },
      });

      // Drain the background price sync triggered by createHolding, then replace
      // the pricing rows with exactly the point we control.
      await helpers.sleep(200);
      await SecurityPricing.destroy({ where: { securityId: security.id } });
      await SecurityPricing.create({
        securityId: security.id,
        date: new Date(),
        priceClose: '110',
        source: SECURITY_PROVIDER.fmp,
      });

      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: 'EUR' },
      });

      await helpers.sleep(DEDUP_CACHE_MS);

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      const rate = EUR_PER_USD / AED_PER_USD;

      expect(summary.currencyCode).toBe('EUR');
      expect(parseFloat(summary.totalCurrentValue)).toBeCloseTo(1100 * rate, 1);
      expect(parseFloat(summary.totalCostBasis)).toBeCloseTo(1000 * rate, 1);
      expect(parseFloat(summary.unrealizedGainValue)).toBeCloseTo(100 * rate, 1);
      // The buy (10 × 100) consumed the 1000 cash deposited in beforeEach, so the
      // portfolio value is the holdings market value (1100) alone.
      expect(parseFloat(summary.totalCashInBaseCurrency)).toBeCloseTo(0, 1);
      expect(parseFloat(summary.totalPortfolioValue)).toBeCloseTo(1100 * rate, 1);
      // Base-currency equivalent stays unconverted for the "~X base" UI line
      expect(summary.baseCurrencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(parseFloat(summary.totalPortfolioValueInBaseCurrency)).toBeCloseTo(1100, 1);
    });

    it('falls back to base currency when the display currency equals base, has no rate, or is reset to null', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      // SSP exists in the Currencies table (so it can be connected and set as a
      // display currency) but the mocked rate providers serve no USD→SSP rate,
      // so the base→display rate lookup fails.
      await helpers.addUserCurrencyByCode({ code: 'SSP', raw: true });

      const setBaseResponse = await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: global.BASE_CURRENCY_CODE },
      });
      expect(setBaseResponse.statusCode).toBe(200);

      const baseSummary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });
      expect(baseSummary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(baseSummary.totalCashInBaseCurrency).toBe('1000.00');
      expect(baseSummary.totalPortfolioValue).toBe('1000.00');

      const setRatelessResponse = await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: 'SSP' },
      });
      expect(setRatelessResponse.statusCode).toBe(200);

      const ratelessSummary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });
      expect(ratelessSummary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(ratelessSummary.totalCashInBaseCurrency).toBe('1000.00');
      expect(ratelessSummary.totalPortfolioValue).toBe('1000.00');

      await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: 'EUR' },
      });

      const resetResponse = await helpers.updatePortfolio({
        portfolioId: portfolio.id,
        payload: { displayCurrencyCode: null },
      });
      expect(resetResponse.statusCode).toBe(200);

      const resetSummary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });
      expect(resetSummary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(resetSummary.totalCashInBaseCurrency).toBe('1000.00');
    }, 30000);

    it('rejects disconnecting a display currency of a portfolio, whether active or trashed', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });

      const activeResponse = await helpers.deleteUserCurrency({ currencyCode: 'EUR' });
      expect(activeResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getUserCurrencies()).map((item) => item.currencyCode)).toContain('EUR');

      await helpers.deletePortfolio({ portfolioId: portfolio.id });

      const trashedResponse = await helpers.deleteUserCurrency({ currencyCode: 'EUR' });
      expect(trashedResponse.statusCode).toBe(ERROR_CODES.ValidationError);
      const err = trashedResponse.body.response as unknown as ErrorResponse;
      expect(err.code).toBe(API_ERROR_CODES.currencyInUse);
      expect(err.details).toEqual({
        blockers: [expect.objectContaining({ type: 'portfolio', id: portfolio.id, trashed: true })],
      });
      expect((await helpers.getUserCurrencies()).map((item) => item.currencyCode)).toContain('EUR');
    });

    it('reconnects an orphaned display currency and converts the summary to it', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });

      // The API guard blocks this disconnect; the orphan state exists in production data.
      await UsersCurrencies.destroy({ where: { currencyCode: 'EUR' } });

      const summary = await helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true });

      expect(summary.currencyCode).toBe('EUR');
      expect(parseFloat(summary.totalPortfolioValue)).toBeCloseTo((1000 * EUR_PER_USD) / AED_PER_USD, 1);

      const userCurrencies = await helpers.getUserCurrencies();
      expect(userCurrencies.map((item) => item.currencyCode)).toContain('EUR');
    }, 30000);
  });

  describe('FX gains', () => {
    // ExchangeRates survives the global truncation (it is seed data), and the
    // global cleanup only drops today-and-later rows, so the trade-date row
    // seeded here has to be removed by hand.
    afterEach(async () => {
      await ExchangeRates.destroy({
        where: {
          baseCode: API_LAYER_BASE_CURRENCY_CODE,
          quoteCode: global.BASE_CURRENCY_CODE,
          date: BUY_DATE_RATE_DATE,
        },
      });
    });

    it('converts cost basis at the current rate when the holding currency moved since the buy', async () => {
      // Upsert: an earlier test file in the same worker may have fetched and stored
      // this date's whole rate basket, USD→base included.
      await ExchangeRates.upsert({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: global.BASE_CURRENCY_CODE,
        rate: BUY_DATE_USD_TO_BASE,
        date: BUY_DATE_RATE_DATE,
      });

      const { portfolio } = await seedHoldingWithHistoricalBuy({ currencyCode: 'USD', symbol: 'FXGN' });

      const holdings = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: {},
        raw: true,
      });

      expect(holdings).toHaveLength(1);
      const holding = holdings[0]!;

      // Fail fast: without the trade-date rate applied there is no FX
      // move between the two dates and nothing left to reproduce.
      expect(parseFloat(holding.refCostBasis)).toBeCloseTo(1000 * BUY_DATE_USD_TO_BASE, 1);
      expect(parseFloat(holding.costBasis)).toBeCloseTo(1000, 1);
      expect(parseFloat(holding.marketValue!)).toBeCloseTo(1200, 1);
      expect(parseFloat(holding.unrealizedGainValue!)).toBeCloseTo(200, 1);

      await helpers.sleep(DEDUP_CACHE_MS);

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(summary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(parseFloat(summary.totalCurrentValue)).toBeCloseTo(1200 * TODAY_USD_TO_BASE, 1);
      expect(parseFloat(summary.totalCostBasis)).toBeCloseTo(1000 * TODAY_USD_TO_BASE, 1);
      expect(parseFloat(summary.unrealizedGainValue)).toBeCloseTo(200 * TODAY_USD_TO_BASE, 1);
      expect(Math.sign(parseFloat(summary.unrealizedGainValue))).toBe(Math.sign(200));
    });

    it('aggregates several holdings across repeated and distinct foreign currencies', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Multi-currency Portfolio' }),
        raw: true,
      });
      await seedHoldingWithHistoricalBuy({ portfolio, currencyCode: 'USD', symbol: 'FXU1' });
      await seedHoldingWithHistoricalBuy({ portfolio, currencyCode: 'USD', symbol: 'FXU2' });
      await seedHoldingWithHistoricalBuy({ portfolio, currencyCode: 'EUR', symbol: 'FXE1' });

      await helpers.sleep(DEDUP_CACHE_MS);

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      // Each holding: cost 1000, market 1200 in its own currency.
      const eurToBase = AED_PER_USD / EUR_PER_USD;
      const nativeUnitsInBase = 2 * TODAY_USD_TO_BASE + eurToBase;

      expect(parseFloat(summary.totalCurrentValue)).toBeCloseTo(1200 * nativeUnitsInBase, 1);
      expect(parseFloat(summary.totalCostBasis)).toBeCloseTo(1000 * nativeUnitsInBase, 1);
      expect(parseFloat(summary.unrealizedGainValue)).toBeCloseTo(200 * nativeUnitsInBase, 1);
    });

    it('reports the same values natively when the holding currency is the base currency', async () => {
      const { portfolio } = await seedHoldingWithHistoricalBuy({
        currencyCode: global.BASE_CURRENCY_CODE,
        symbol: 'FXBS',
      });

      await helpers.sleep(DEDUP_CACHE_MS);

      const summary = await helpers.getPortfolioSummary({
        portfolioId: portfolio.id,
        raw: true,
      });

      expect(summary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
      expect(summary.totalCurrentValue).toBe('1200.00');
      expect(summary.totalCostBasis).toBe('1000.00');
      expect(summary.unrealizedGainValue).toBe('200.00');
      expect(summary.totalCashInBaseCurrency).toBe('0.00');
    });
  });
});
