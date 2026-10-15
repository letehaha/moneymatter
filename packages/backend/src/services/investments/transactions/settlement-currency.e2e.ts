import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { beforeEach, describe, expect, it } from '@jest/globals';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as helpers from '@tests/helpers';

describe('Investment transaction settlement currency', () => {
  let portfolio: Portfolios;
  let security: Securities;
  let securityCurrencyCode: string;

  beforeEach(async () => {
    portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Settlement Test Portfolio' }),
      raw: true,
    });

    const seeded = await helpers.seedSecurities([{ symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }]);
    security = seeded.find((s) => s.symbol === 'VOO')!;
    securityCurrencyCode = security.currencyCode;

    await helpers.createHolding({
      payload: { portfolioId: portfolio.id, securityId: security.id },
    });

    await helpers.updatePortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode: securityCurrencyCode,
      setAvailableCash: '10000',
      setTotalCash: '10000',
    });
  });

  describe('same-currency settlement (fee derived from total spent)', () => {
    it('derives the fee as totalSpent - quantity*price on BUY', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '99.5',
          settlementCurrencyCode: securityCurrencyCode,
          settlementAmount: '500',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // 500 - 5*99.5 = 2.5
      expect(tx.fees).toBeNumericEqual(2.5);
      expect(tx.amount).toBeNumericEqual(500);
      expect(tx.settlementAmount).toBeNumericEqual(500);
      expect(tx.settlementFees).toBeNumericEqual(2.5);
      expect(tx.settlementRate).toBeNumericEqual(1);
      expect(tx.settlementCurrencyCode).toBe(securityCurrencyCode);

      const [balance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: securityCurrencyCode,
        raw: true,
      });
      expect(balance!.availableCash).toBeNumericEqual(9500);
    });

    it('derives the fee as quantity*price - totalReceived on SELL', async () => {
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // Cash after buy: 9000
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '5',
          price: '120',
          settlementCurrencyCode: securityCurrencyCode,
          settlementAmount: '590',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // 5*120 - 590 = 10
      expect(tx.fees).toBeNumericEqual(10);
      expect(tx.settlementAmount).toBeNumericEqual(590);

      const [balance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: securityCurrencyCode,
        raw: true,
      });
      expect(balance!.availableCash).toBeNumericEqual(9590);
    });
  });

  describe('cross-currency settlement (PLN cash, USD security)', () => {
    it('records BUY paid in PLN with explicit fee and derives the broker rate', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // rate = (1700 - 15) / (5 * 92.07) = 1685 / 460.35
      const expectedRate = 1685 / 460.35;
      expect(Number(tx.settlementRate)).toBeCloseTo(expectedRate, 8);
      expect(tx.settlementCurrencyCode).toBe('PLN');
      expect(tx.settlementAmount).toBeNumericEqual(1700);
      expect(tx.settlementFees).toBeNumericEqual(15);
      // fee converted to the security currency at the derived rate
      expect(Number(tx.fees)).toBeCloseTo(15 / expectedRate, 6);
      expect(Number(tx.amount)).toBeCloseTo(460.35 + 15 / expectedRate, 6);
      expect(tx.currencyCode).toBe(securityCurrencyCode);

      // Cash leaves the PLN balance...
      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(-1700);

      // ...and the security-currency balance is untouched
      const [usdBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: securityCurrencyCode,
        raw: true,
      });
      expect(usdBalance!.availableCash).toBeNumericEqual(10000);
    });

    it('auto-connects the settlement currency to the user when not connected yet', async () => {
      const currenciesBefore = await helpers.getUserCurrencies();
      expect(currenciesBefore.some((c) => c.currencyCode === 'PLN')).toBe(false);

      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });

      expect(response.statusCode).toBe(201);

      const currenciesAfter = await helpers.getUserCurrencies();
      expect(currenciesAfter.some((c) => c.currencyCode === 'PLN')).toBe(true);
    });

    it('folds the whole spread into the rate when fee is 0', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '0',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      expect(Number(tx.settlementRate)).toBeCloseTo(1700 / 460.35, 8);
      expect(tx.fees).toBeNumericEqual(0);
      expect(tx.amount).toBeNumericEqual(460.35);
    });

    it('records SELL received in PLN (proceeds net of fee)', async () => {
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '5',
          price: '100',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1800',
          settlementFees: '10',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // gross = 1800 + 10 = 1810; rate = 1810 / (5*100) = 3.62
      expect(tx.settlementRate).toBeNumericEqual(3.62);
      expect(Number(tx.fees)).toBeCloseTo(10 / 3.62, 6);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(1800);
    });

    it('records DIVIDEND credited in PLN', async () => {
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
          quantity: '10',
          price: '2',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '70',
          settlementFees: '5',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // gross = 70 + 5 = 75; rate = 75 / (10*2) = 3.75
      expect(tx.settlementRate).toBeNumericEqual(3.75);
      // Net of the fee in USD: 20 - 5 / 3.75
      expect(tx.amount).toBeNumericEqual(18.6666666667);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(70);
    });

    it('derives the fee from the market rate when neither fee nor rate is given', async () => {
      // Mocked market rate: 1 USD = 4.105698 PLN → market-priced notional
      // 460.35 * 4.105698 ≈ 1890.06 PLN; cash paid above it is the fee.
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1900',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      const recordedRate = Number(tx.settlementRate);
      expect(recordedRate).toBeCloseTo(4.105698, 3);
      // Fee is exactly the residual against the recorded rate
      expect(Number(tx.settlementFees)).toBeCloseTo(1900 - 460.35 * recordedRate, 4);
      expect(Number(tx.settlementFees)).toBeGreaterThan(0);
      expect(tx.settlementAmount).toBeNumericEqual(1900);
    });

    it('clamps a negative market-rate residual to zero fee and folds it into the rate', async () => {
      // 1700 PLN paid is BELOW the market-priced notional (~1890 PLN): the
      // broker rate simply beat the market rate, not a negative fee.
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      expect(tx.settlementFees).toBeNumericEqual(0);
      expect(tx.fees).toBeNumericEqual(0);
      expect(Number(tx.settlementRate)).toBeCloseTo(1700 / 460.35, 8);
    });

    it('derives the fee from a user-supplied exchange rate', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementRate: '3.66',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      // fee = 1700 - 460.35 * 3.66 = 15.119 PLN
      expect(tx.settlementRate).toBeNumericEqual(3.66);
      expect(Number(tx.settlementFees)).toBeCloseTo(15.119, 6);
      expect(Number(tx.fees)).toBeCloseTo(15.119 / 3.66, 6);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(-1700);
    });
  });

  describe('settlement payload rejections', () => {
    it('rejects invalid settlement payloads', async () => {
      const cases = [
        {
          name: 'totalSpent below quantity*price on BUY (negative fee)',
          payload: {
            quantity: '5',
            price: '100',
            settlementCurrencyCode: securityCurrencyCode,
            settlementAmount: '480',
          },
        },
        {
          name: 'settlementFees for same-currency settlement',
          payload: {
            quantity: '5',
            price: '99.5',
            settlementCurrencyCode: securityCurrencyCode,
            settlementAmount: '500',
            settlementFees: '2.5',
          },
        },
        {
          name: 'settlementFees and settlementRate together',
          payload: {
            quantity: '5',
            price: '92.07',
            settlementCurrencyCode: 'PLN',
            settlementAmount: '1700',
            settlementFees: '15',
            settlementRate: '3.66',
          },
        },
        {
          name: 'cross-currency settlement with zero price (no rate derivable)',
          payload: {
            quantity: '5',
            price: '0',
            settlementCurrencyCode: 'PLN',
            settlementAmount: '1700',
            settlementFees: '0',
          },
        },
        {
          name: 'fees not covered by cash moved on BUY',
          payload: {
            quantity: '5',
            price: '92.07',
            settlementCurrencyCode: 'PLN',
            settlementAmount: '10',
            settlementFees: '15',
          },
        },
        {
          name: 'settlementCurrencyCode without settlementAmount',
          payload: { quantity: '5', price: '100', settlementCurrencyCode: 'PLN' },
        },
        {
          name: 'settlementAmount without settlementCurrencyCode',
          payload: { quantity: '5', price: '100', settlementAmount: '500' },
        },
      ];

      const outcomes: { name: string; statusCode: number }[] = [];

      for (const { name, payload } of cases) {
        const response = await helpers.createInvestmentTransaction({
          payload: {
            portfolioId: portfolio.id,
            securityId: security.id,
            category: INVESTMENT_TRANSACTION_CATEGORY.buy,
            ...payload,
          },
        });
        outcomes.push({ name, statusCode: response.statusCode });
      }

      expect(outcomes).toEqual(cases.map(({ name }) => ({ name, statusCode: 422 })));
    }, 30000);
  });

  describe('delete reverses settlement-currency cash', () => {
    it('restores the PLN balance when a PLN-settled BUY is deleted', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });
      const tx = helpers.extractResponse(response);

      const [before] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(before!.availableCash).toBeNumericEqual(-1700);

      await helpers.deleteInvestmentTransaction({ transactionId: tx.id, raw: true });

      const [after] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(after!.availableCash).toBeNumericEqual(0);
    });
  });

  describe('update with settlement leg', () => {
    it('re-derives the rate and adjusts cash when settlementAmount changes', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });
      const tx = helpers.extractResponse(response);

      const updateResponse = await helpers.updateInvestmentTransaction({
        transactionId: tx.id,
        payload: {
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1750',
          settlementFees: '15',
        },
      });
      expect(updateResponse.statusCode).toBe(200);
      const updated = helpers.extractResponse(updateResponse);

      expect(Number(updated.settlementRate)).toBeCloseTo((1750 - 15) / 460.35, 8);
      expect(updated.settlementAmount).toBeNumericEqual(1750);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(-1750);
    });

    it('keeps the broker rate and recomputes cash when only quantity changes', async () => {
      const createResponse = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });
      const tx = helpers.extractResponse(createResponse);
      const originalRate = Number(tx.settlementRate);

      const updateResponse = await helpers.updateInvestmentTransaction({
        transactionId: tx.id,
        payload: { quantity: '10' },
      });
      expect(updateResponse.statusCode).toBe(200);
      const updated = helpers.extractResponse(updateResponse);

      expect(Number(updated.settlementRate)).toBeCloseTo(originalRate, 8);
      // new cash = 10 * 92.07 * rate + 15 ≈ 2*1685 + 15 = 3385
      expect(Number(updated.settlementAmount)).toBeCloseTo(3385, 4);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(Number(plnBalance!.availableCash)).toBeCloseTo(-3385, 4);
    });

    it('re-derives the fee when settlementRate is sent together with settlementAmount', async () => {
      const createResponse = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '0',
        },
      });
      const tx = helpers.extractResponse(createResponse);

      const updateResponse = await helpers.updateInvestmentTransaction({
        transactionId: tx.id,
        payload: {
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementRate: '3.66',
        },
      });
      expect(updateResponse.statusCode).toBe(200);
      const updated = helpers.extractResponse(updateResponse);

      // fee = 1700 - 460.35 * 3.66 = 15.119 PLN
      expect(updated.settlementRate).toBeNumericEqual(3.66);
      expect(Number(updated.settlementFees)).toBeCloseTo(15.119, 6);

      const [plnBalance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'PLN',
        raw: true,
      });
      expect(plnBalance!.availableCash).toBeNumericEqual(-1700);
    });

    it('rejects updating the security-currency fees on a cross-currency transaction', async () => {
      const createResponse = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '5',
          price: '92.07',
          settlementCurrencyCode: 'PLN',
          settlementAmount: '1700',
          settlementFees: '15',
        },
      });
      const tx = helpers.extractResponse(createResponse);

      const updateResponse = await helpers.updateInvestmentTransaction({
        transactionId: tx.id,
        payload: { fees: '5' },
      });
      expect(updateResponse.statusCode).toBe(422);
    });
  });

  describe('legacy payloads (no settlement fields)', () => {
    it('defaults the settlement leg to the security currency at rate 1', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '100',
          fees: '5',
        },
      });

      expect(response.statusCode).toBe(201);
      const tx = helpers.extractResponse(response);

      expect(tx.settlementCurrencyCode).toBe(securityCurrencyCode);
      expect(tx.settlementAmount).toBeNumericEqual(1005);
      expect(tx.settlementFees).toBeNumericEqual(5);
      expect(tx.settlementRate).toBeNumericEqual(1);

      const [balance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: securityCurrencyCode,
        raw: true,
      });
      expect(balance!.availableCash).toBeNumericEqual(8995);
    });
  });
});
