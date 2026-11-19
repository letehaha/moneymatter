import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UsersCurrencies from '@models/users-currencies.model';
import * as helpers from '@tests/helpers';
// USD-based rates served by the mocked rates provider for on-demand date
// lookups. The security is denominated in the base currency (AED), so the
// native→EUR conversion rate is EUR_PER_USD / AED_PER_USD via the USD pivot.
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';

const AED_TO_EUR = EUR_PER_USD / AED_PER_USD;

// getHoldingValues deduplicates identical requests for 1 second; consecutive
// getHoldings calls in the same test must outwait that window to observe the
// effect of a displayCurrencyCode change.
const DEDUP_CACHE_MS = 1100;

describe('Holdings display currency (GET /investments/portfolios/:id/holdings)', () => {
  let portfolio: Portfolios;
  let security: Securities;

  beforeEach(async () => {
    portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Holdings Display Currency Portfolio' }),
      raw: true,
    });

    // Security denominated in the base currency so the FX-free numbers are
    // deterministic: costBasis 1000, marketValue 1100, unrealized gain 100.
    security = await Securities.create({
      symbol: 'DSPL',
      providerSymbol: 'DSPL',
      currencyCode: global.BASE_CURRENCY_CODE,
      providerName: SECURITY_PROVIDER.fmp,
      assetClass: ASSET_CLASS.stocks,
      name: 'Display Currency Test Security',
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
  });

  it('reflects the portfolio display currency in holding values', async () => {
    const withoutDisplayCurrency = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });

    expect(withoutDisplayCurrency).toHaveLength(1);
    const nativeOnly = withoutDisplayCurrency[0]!;

    expect(parseFloat(nativeOnly.marketValue!)).toBeCloseTo(1100, 1);
    expect(parseFloat(nativeOnly.costBasis)).toBeCloseTo(1000, 1);
    expect(nativeOnly.displayCurrencyCode).toBeUndefined();
    expect(nativeOnly.displayMarketValue).toBeUndefined();
    expect(nativeOnly.displayCostBasis).toBeUndefined();

    await helpers.updatePortfolio({
      portfolioId: portfolio.id,
      payload: { displayCurrencyCode: global.BASE_CURRENCY_CODE },
    });

    await helpers.sleep(DEDUP_CACHE_MS);

    const withBaseCurrency = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });

    expect(withBaseCurrency).toHaveLength(1);
    const identityConverted = withBaseCurrency[0]!;

    expect(identityConverted.displayCurrencyCode).toBe(global.BASE_CURRENCY_CODE);
    expect(parseFloat(identityConverted.displayMarketValue!)).toBeCloseTo(1100, 1);
    expect(parseFloat(identityConverted.displayCostBasis!)).toBeCloseTo(1000, 1);
    expect(parseFloat(identityConverted.displayUnrealizedGainValue!)).toBeCloseTo(100, 1);

    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    await helpers.updatePortfolio({
      portfolioId: portfolio.id,
      payload: { displayCurrencyCode: 'EUR' },
    });

    await helpers.sleep(DEDUP_CACHE_MS);

    const withEur = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });

    expect(withEur).toHaveLength(1);
    const converted = withEur[0]!;

    // Native values untouched
    expect(parseFloat(converted.marketValue!)).toBeCloseTo(1100, 1);
    expect(parseFloat(converted.costBasis)).toBeCloseTo(1000, 1);

    expect(converted.displayCurrencyCode).toBe('EUR');
    expect(parseFloat(converted.displayMarketValue!)).toBeCloseTo(1100 * AED_TO_EUR, 1);
    expect(parseFloat(converted.displayCostBasis!)).toBeCloseTo(1000 * AED_TO_EUR, 1);
    expect(parseFloat(converted.displayUnrealizedGainValue!)).toBeCloseTo(100 * AED_TO_EUR, 1);
    expect(parseFloat(converted.displayRealizedGainValue!)).toBeCloseTo(0, 2);
  }, 30000);

  it('returns display fields in an orphaned display currency', async () => {
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    await helpers.updatePortfolio({
      portfolioId: portfolio.id,
      payload: { displayCurrencyCode: 'EUR' },
    });

    // The API guard blocks this disconnect; the orphan state exists in production data.
    await UsersCurrencies.destroy({ where: { currencyCode: 'EUR' } });

    await helpers.sleep(DEDUP_CACHE_MS);

    const holdings = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: {},
      raw: true,
    });

    expect(holdings).toHaveLength(1);
    const holding = holdings[0]!;

    expect(parseFloat(holding.marketValue!)).toBeCloseTo(1100, 1);
    expect(holding.displayCurrencyCode).toBe('EUR');
    expect(parseFloat(holding.displayMarketValue!)).toBeCloseTo(1100 * AED_TO_EUR, 1);
  });

  it('omits display fields when no rate exists for the display currency', async () => {
    // SSP exists in the Currencies table (so it can be connected and set as a
    // display currency) but the mocked rate providers serve no USD→SSP rate,
    // so the native→display rate lookup fails and holdings must degrade
    // gracefully by omitting display fields.
    await helpers.addUserCurrencyByCode({ code: 'SSP', raw: true });
    await helpers.updatePortfolio({
      portfolioId: portfolio.id,
      payload: { displayCurrencyCode: 'SSP' },
    });

    await helpers.sleep(DEDUP_CACHE_MS);

    const holdings = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: {},
      raw: true,
    });

    expect(holdings).toHaveLength(1);
    const holding = holdings[0]!;

    // Native values untouched
    expect(parseFloat(holding.marketValue!)).toBeCloseTo(1100, 1);
    expect(parseFloat(holding.costBasis)).toBeCloseTo(1000, 1);

    expect(holding.displayCurrencyCode).toBeUndefined();
    expect(holding.displayMarketValue).toBeUndefined();
    expect(holding.displayCostBasis).toBeUndefined();
    expect(holding.displayUnrealizedGainValue).toBeUndefined();
    expect(holding.displayRealizedGainValue).toBeUndefined();
  });

  it('sums dividend income net of fees, with a display variant', async () => {
    for (const [price, fees] of [
      ['25', '5'],
      ['12.5', '0'],
    ] as const) {
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
          quantity: '1',
          price,
          fees,
        },
      });
    }

    await helpers.sleep(DEDUP_CACHE_MS);
    const [nativeOnly] = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
    expect(nativeOnly!.dividendIncome).toBe('32.50');
    expect(nativeOnly!.displayDividendIncome).toBeUndefined();

    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });
    await helpers.sleep(DEDUP_CACHE_MS);

    const [converted] = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
    expect(converted!.dividendIncome).toBe('32.50');
    expect(parseFloat(converted!.displayDividendIncome!)).toBeCloseTo(32.5 * AED_TO_EUR, 1);
  });

  it('reports zero dividend income for a holding without dividends', async () => {
    const [holding] = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
    expect(holding!.dividendIncome).toBe('0.00');
  });
});
