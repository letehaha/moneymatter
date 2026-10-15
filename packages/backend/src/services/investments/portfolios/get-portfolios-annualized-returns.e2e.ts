import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import ExchangeRates from '@models/exchange-rates.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { format, parseISO, subDays } from 'date-fns';

const today = () => format(new Date(), 'yyyy-MM-dd');
const daysAgo = ({ days }: { days: number }) => format(subDays(new Date(), days), 'yyyy-MM-dd');

/**
 * Creates a stock security denominated in the test base currency (AED) so that
 * the FX rate is 1:1 and the time-weighted return is driven purely by the
 * seeded prices — keeping the assertions deterministic.
 */
const createBaseCurrencySecurity = async ({ symbol }: { symbol: string }) =>
  Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode: global.BASE_CURRENCY_CODE,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: `${symbol} Test Security`,
  });

const seedPrices = async ({
  securityId,
  points,
}: {
  securityId: string;
  points: Array<{ date: string; price: string }>;
}) => {
  // Drain the background price sync triggered by createHolding, then replace the
  // pricing rows with exactly the points we control.
  await helpers.sleep(200);
  await SecurityPricing.destroy({ where: { securityId } });
  for (const point of points) {
    await SecurityPricing.create({
      securityId,
      date: parseISO(point.date),
      priceClose: point.price,
      source: SECURITY_PROVIDER.fmp,
    });
  }
};

describe('GET /investments/portfolios/annualized-returns', () => {
  it('returns an empty array when the user has no portfolios', async () => {
    const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
    expect(result).toEqual([]);
  });

  describe('with portfolios', () => {
    let portfolio: Portfolios;

    beforeEach(async () => {
      portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Returns Test Portfolio' }),
        raw: true,
      });
    });

    it('reports not-enough-history for a portfolio with no transactions', async () => {
      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });

      const entry = result.find((r) => r.portfolioId === portfolio.id)!;
      expect(entry).toBeDefined();
      expect(entry.annualizedReturn).toBeNull();
      expect(entry.hasEnoughHistory).toBe(false);
      expect(entry.startDate).toBeNull();
      expect(entry.periodDays).toBe(0);
      expect(entry.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    });

    it('reports not-enough-history when the history is shorter than the minimum', async () => {
      const security = await createBaseCurrencySecurity({ symbol: 'SHORT' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 30 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await seedPrices({
        securityId: security.id,
        points: [
          { date: daysAgo({ days: 30 }), price: '100' },
          { date: today(), price: '150' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      expect(entry.annualizedReturn).toBeNull();
      expect(entry.hasEnoughHistory).toBe(false);
      expect(entry.startDate).toBe(daysAgo({ days: 30 }));
      expect(entry.periodDays).toBeGreaterThan(0);
    });

    it('computes the annualized time-weighted return over a full year', async () => {
      const security = await createBaseCurrencySecurity({ symbol: 'YEAR' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      // Bought at 100, worth 120 today → +20% over exactly 365 days → ~20%/yr.
      await seedPrices({
        securityId: security.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: today(), price: '120' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      expect(entry.hasEnoughHistory).toBe(true);
      expect(entry.startDate).toBe(daysAgo({ days: 365 }));
      expect(entry.periodDays).toBe(365);
      expect(entry.annualizedReturn).toBeCloseTo(20, 1);
      expect(entry.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    });

    it('chains sub-period returns and excludes mid-period contributions', async () => {
      // Two buys at different prices. TWR must measure the holdings' performance
      // only, treating the second buy as new capital (not a return) — otherwise
      // the contribution would leak into the figure.
      const security = await createBaseCurrencySecurity({ symbol: 'CHAIN' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 182 }),
          quantity: '1',
          price: '110',
        },
        raw: true,
      });
      await seedPrices({
        securityId: security.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: daysAgo({ days: 182 }), price: '110' },
          { date: today(), price: '121' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      // Sub-period 1: 100 → 110 (+10%). Sub-period 2: 220 → 242 on 2 shares
      // (+10%). Chained: 1.1 × 1.1 = 1.21 → ~21%/yr. A naive total-return metric
      // that counted the +110 contribution as growth would land near ~15%, so
      // the 21% result proves the contribution is excluded.
      expect(entry.hasEnoughHistory).toBe(true);
      expect(entry.annualizedReturn).toBeCloseTo(21, 0);
    });

    it('does not treat a partial sell as a loss', async () => {
      // Selling shares is a withdrawal of capital, not a negative return. The
      // sub-period spanning the sell must stay flat (price unchanged), so the
      // whole return comes from the pre-sell appreciation.
      const security = await createBaseCurrencySecurity({ symbol: 'PSELL' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '2',
          price: '100',
        },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          date: daysAgo({ days: 182 }),
          quantity: '1',
          price: '150',
        },
        raw: true,
      });
      await seedPrices({
        securityId: security.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: daysAgo({ days: 182 }), price: '150' },
          { date: today(), price: '150' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      // Sub-period 1: 200 → 300 on 2 shares (+50%). Sub-period 2: 1 share held
      // flat at 150 (0%). Chained: 1.5 × 1.0 = 1.5 → ~50%/yr. The sell itself
      // must not register as a drop.
      expect(entry.hasEnoughHistory).toBe(true);
      expect(entry.annualizedReturn).toBeCloseTo(50, 0);
    });

    it('reports each portfolio independently, including negative returns', async () => {
      // `portfolio` (from beforeEach) gains; a second portfolio loses. Both must
      // appear in one response with their own independent figures — proving the
      // per-portfolio grouping doesn't leak transactions across portfolios.
      const gainSecurity = await createBaseCurrencySecurity({ symbol: 'GAIN' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: gainSecurity.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: gainSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await seedPrices({
        securityId: gainSecurity.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: today(), price: '120' },
        ],
      });

      const losingPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Losing Portfolio' }),
        raw: true,
      });
      const loseSecurity = await createBaseCurrencySecurity({ symbol: 'LOSE' });
      await helpers.createHolding({ payload: { portfolioId: losingPortfolio.id, securityId: loseSecurity.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: losingPortfolio.id,
          securityId: loseSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await seedPrices({
        securityId: loseSecurity.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: today(), price: '80' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const gain = result.find((r) => r.portfolioId === portfolio.id)!;
      const lose = result.find((r) => r.portfolioId === losingPortfolio.id)!;

      // 100 → 120 over a year ≈ +20%/yr; 100 → 80 ≈ -20%/yr.
      expect(gain.annualizedReturn).toBeCloseTo(20, 0);
      expect(lose.annualizedReturn).toBeCloseTo(-20, 0);
    });

    it('applies FX conversion for a non-base-currency (USD) security', async () => {
      // Base currency is AED; this security is in USD, so a real USD→AED
      // cross-rate is applied at each valuation boundary (the other tests use
      // AED securities, where the 1:1 rate hides any FX bug). The rate DIFFERS
      // between the start and end of the period so the FX move is baked into
      // the return: a 1:1 fallback would yield ~20%/yr (raw price move), but
      // the real answer is higher because the dollar also rose against AED.
      //
      // valueHoldings values a USD holding as quantity * price * USD→AED rate:
      //   start: 1 * $100 * 3 = 300 AED
      //   today: 1 * $120 * 4 = 480 AED
      //   TWR factor = 480 / 300 = 1.6 over exactly 365 days → ~60%/yr.
      const startDate = daysAgo({ days: 365 });

      const security = await Securities.create({
        symbol: 'USDFX',
        providerSymbol: 'USDFX',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'USD FX Test Security',
      });

      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: startDate,
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await seedPrices({
        securityId: security.id,
        points: [
          { date: startDate, price: '100' },
          { date: today(), price: '120' },
        ],
      });

      // ExchangeRates survives test truncation (it is seed data), and the
      // investment-transaction create flow lazily writes a USD→AED row via
      // calculateRefAmount. Wipe both so only the two deterministic rates we
      // seed below exist for this pair.
      await ExchangeRates.destroy({ where: { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED' } });
      await UserExchangeRates.destroy({ where: { userId: 1, baseCode: 'USD', quoteCode: 'AED' } });

      // `date` is a DATE column; seed JS Dates the service normalizes to
      // yyyy-MM-dd. USD→AED = 3 at the buy, 4 today.
      await ExchangeRates.bulkCreate([
        { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 3, date: parseISO(startDate) },
        { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 4, date: parseISO(today()) },
      ]);

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      expect(entry.hasEnoughHistory).toBe(true);
      expect(entry.periodDays).toBe(365);
      // 300 AED → 480 AED over 365 days = +60%/yr. NOT the ~20% a 1:1 FX
      // fallback (or an unconverted USD figure) would produce.
      expect(entry.annualizedReturn).toBeCloseTo(60, 0);
      expect(entry.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    });

    it('converts a buy dated before the first stored rate at that rate, not 1:1', async () => {
      // Taken before the fixture so a rate row written while creating the buy is deleted
      // in `finally`, not restored.
      const usdToBaseWhere = { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED' };
      const storedRates = (await ExchangeRates.findAll({ where: usdToBaseWhere, raw: true })).map(
        ({ baseCode, quoteCode, date, rate, source }) => ({ baseCode, quoteCode, date, rate, source }),
      );

      try {
        const startDate = daysAgo({ days: 365 });

        const security = await Securities.create({
          symbol: 'USDLATE',
          providerSymbol: 'USDLATE',
          currencyCode: 'USD',
          providerName: SECURITY_PROVIDER.fmp,
          assetClass: ASSET_CLASS.stocks,
          name: 'USD Late Rate Test Security',
        });

        await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
        await helpers.createInvestmentTransaction({
          payload: {
            portfolioId: portfolio.id,
            securityId: security.id,
            category: INVESTMENT_TRANSACTION_CATEGORY.buy,
            date: startDate,
            quantity: '1',
            price: '100',
          },
          raw: true,
        });
        await seedPrices({
          securityId: security.id,
          points: [
            { date: startDate, price: '100' },
            { date: today(), price: '120' },
          ],
        });

        // A USD→AED rate on or before the buy would give the start boundary a real rate,
        // and any other rate between the buy and today would replace the one seeded here
        // as the earliest. Today's rate must be the only one.
        await ExchangeRates.destroy({ where: usdToBaseWhere });
        await UserExchangeRates.destroy({ where: { userId: 1, baseCode: 'USD', quoteCode: 'AED' } });
        await ExchangeRates.create({ ...usdToBaseWhere, rate: 4, date: parseISO(today()) });

        const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
        const entry = result.find((r) => r.portfolioId === portfolio.id)!;

        expect(entry.hasEnoughHistory).toBe(true);
        expect(entry.periodDays).toBe(365);
        // Both boundaries convert at 4: 1 * $100 * 4 = 400 AED → 1 * $120 * 4 = 480 AED,
        // a 1.2 factor over 365 days = +20%/yr. A 1:1 start value of 100 AED gives 380%/yr.
        expect(entry.annualizedReturn).toBeCloseTo(20, 0);
      } finally {
        await ExchangeRates.destroy({ where: usdToBaseWhere });
        await ExchangeRates.bulkCreate(storedRates, { ignoreDuplicates: true });
      }
    });

    it('does not inflate the return when a holding is unpriced at its buy date', async () => {
      // Reproduces the real-world case: a security whose price history does not
      // reach back to the (back-dated) buy. The unpriced holding must fall back
      // to its cost basis at the buy boundary — otherwise it is valued at 0 when
      // bought and at full price later, injecting a phantom return.
      const buyDay = daysAgo({ days: 300 });

      const priced = await createBaseCurrencySecurity({ symbol: 'PRICED' });
      const latePriced = await createBaseCurrencySecurity({ symbol: 'LATEPRICE' });

      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: priced.id } });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: latePriced.id } });

      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: priced.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: buyDay,
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: latePriced.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: buyDay,
          quantity: '1',
          price: '100',
        },
        raw: true,
      });

      // PRICED has a price at the buy date; LATEPRICE only gets a price today
      // (none at or before the buy). Both end flat-ish, so the true return is
      // small: cost basis 200 → value 210 over 300 days ≈ 6%/yr.
      await seedPrices({
        securityId: priced.id,
        points: [
          { date: buyDay, price: '100' },
          { date: today(), price: '110' },
        ],
      });
      await seedPrices({ securityId: latePriced.id, points: [{ date: today(), price: '100' }] });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      expect(entry.hasEnoughHistory).toBe(true);
      // Must be the real ~6%/yr, NOT the phantom ~140%/yr the skip-when-unpriced
      // bug produced.
      expect(entry.annualizedReturn).toBeLessThan(20);
      expect(entry.annualizedReturn).toBeCloseTo(6.1, 0);
    });

    it('counts the buy fee once in the cost basis of an unpriced holding', async () => {
      const buyDay = daysAgo({ days: 365 });
      const security = await createBaseCurrencySecurity({ symbol: 'FEEBASIS' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: buyDay,
          quantity: '1',
          price: '100',
          fees: '5',
        },
        raw: true,
      });
      await seedPrices({ securityId: security.id, points: [{ date: today(), price: '126' }] });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      // Unpriced at the buy → valued at cost basis 1 * 100 + 5 = 105; today 126.
      // 126 / 105 = 1.2 over 365 days → 20%/yr. Fee counted twice: 126 / 110 → ~14.5%.
      expect(entry.periodDays).toBe(365);
      expect(entry.annualizedReturn).toBeCloseTo(20, 0);
    });

    it('adds a dividend to the period return at its amount net of fees', async () => {
      const security = await createBaseCurrencySecurity({ symbol: 'DIVNET' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: daysAgo({ days: 365 }),
          quantity: '1',
          price: '100',
        },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
          date: daysAgo({ days: 182 }),
          quantity: '1',
          price: '10',
          fees: '2',
        },
        raw: true,
      });
      await seedPrices({
        securityId: security.id,
        points: [
          { date: daysAgo({ days: 365 }), price: '100' },
          { date: today(), price: '100' },
        ],
      });

      const result = await helpers.getPortfoliosAnnualizedReturns({ raw: true });
      const entry = result.find((r) => r.portfolioId === portfolio.id)!;

      // Flat price, dividend 1 * 10 - 2 = 8: (100 + 8) / 100 = 1.08 over 365 days → 8%/yr.
      // Gross (10) would give 10%, gross plus fee (12) 12%.
      expect(entry.periodDays).toBe(365);
      expect(entry.annualizedReturn).toBeCloseTo(8, 0);
    });
  });
});
