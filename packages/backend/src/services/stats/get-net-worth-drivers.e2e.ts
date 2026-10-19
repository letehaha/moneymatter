import {
  ACCOUNT_CATEGORIES,
  ASSET_CLASS,
  INVESTMENT_TRANSACTION_CATEGORY,
  SECURITY_PROVIDER,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { until } from '@common/helpers';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import ExchangeRates from '@models/exchange-rates.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { Op } from 'sequelize';

// A fixed two-month window in the past: bucket edges are exact calendar months
// and no bucket is the in-progress one, so every assertion is deterministic.
const JAN = { start: '2026-01-01', end: '2026-01-31' };
const FEB = { start: '2026-02-01', end: '2026-02-28' };
const RANGE = { from: JAN.start, to: FEB.end, granularity: 'monthly' as const };

/**
 * Securities priced in the user's base currency (AED), so `getExchangeRate`
 * short-circuits to 1 and the numbers under test are the report's math rather
 * than an FX cross-rate.
 */
const createBaseCurrencySecurity = async () =>
  Securities.create({
    symbol: 'EMAAR',
    providerSymbol: 'EMAAR',
    currencyCode: global.BASE_CURRENCY_CODE,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: 'Emaar Properties',
  });

/**
 * `createHolding` kicks off an un-awaited historical price sync. The sync commits
 * every row it fetches together with the security's `pricingLastSyncedAt` marker
 * in one transaction, so a non-null marker means those rows are already visible
 * and safe to wipe; under the test data-provider mocks the fetch yields nothing
 * and the marker stays null, so a row count that stops moving is the fallback
 * signal that the sync has finished. Wait for whichever settles first before
 * wiping — a fixed sleep would let a slow sync insert after the destroy, leaking
 * rows that then shift every price assertion in the file and read as a math bug.
 */
const seedHolding = async ({ portfolioId, securityId }: { portfolioId: string; securityId: string }) => {
  await helpers.createHolding({ payload: { portfolioId, securityId } });

  let lastCount = -1;
  let stableReads = 0;
  await until(
    async () => {
      const [security, count] = await Promise.all([
        Securities.findByPk(securityId, { attributes: ['pricingLastSyncedAt'] }),
        SecurityPricing.count({ where: { securityId } }),
      ]);
      if (security?.pricingLastSyncedAt) return true;
      if (count === lastCount) {
        stableReads += 1;
      } else {
        stableReads = 0;
        lastCount = count;
      }
      // Three consecutive equal reads: the sync has stopped inserting for this security.
      return stableReads >= 2;
    },
    { timeout: 5000, interval: 50 },
  );

  await SecurityPricing.destroy({ where: { securityId } });
};

const setPrice = async ({ securityId, date, price }: { securityId: string; date: string; price: string }) =>
  SecurityPricing.create({
    securityId,
    date: new Date(`${date}T00:00:00.000Z`),
    priceClose: price,
    source: SECURITY_PROVIDER.fmp,
  });

/**
 * A buy drains portfolio cash negative, which would drag the composition's cash
 * side. Fund the portfolio first so the fixture reflects a real deposit-then-buy.
 */
const fundPortfolio = async ({ portfolioId, amount, date }: { portfolioId: string; amount: string; date: string }) =>
  helpers.directCashTransaction({
    portfolioId,
    payload: { type: 'deposit', amount, currencyCode: global.BASE_CURRENCY_CODE, date },
    raw: true,
  });

describe('GET /stats/net-worth-drivers', () => {
  describe('savings', () => {
    it('reports income minus expenses per bucket', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.expense,
          time: `${JAN.start}T11:00:00.000Z`,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.income,
          time: `${FEB.start}T10:00:00.000Z`,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1800,
          transactionType: TRANSACTION_TYPES.expense,
          time: `${FEB.start}T11:00:00.000Z`,
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets).toHaveLength(2);
      expect(buckets[0]!.savings).toEqual({ income: 5000, expenses: 2000, net: 3000 });
      expect(buckets[1]!.savings).toEqual({ income: 1000, expenses: 1800, net: -800 });
    });

    it('excludes transfers between the user own accounts', async () => {
      const [accountA, accountB] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: `${JAN.start}T10:00:00.000Z`,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: accountB.id,
          destinationAmount: 500,
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets[0]!.savings).toEqual({ income: 0, expenses: 0, net: 0 });
    });

    it('excludes accounts marked excluded from stats', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.updateAccount({ id: account.id, payload: { excludeFromStats: true } });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets[0]!.savings.income).toBe(0);
    });

    it('nets full and partial refunds out of both sides of savings', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });
      const [fullyRefundedExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2026-01-10T10:00:00.000Z',
        }),
        raw: true,
      });
      const [fullRefundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
          time: '2026-01-20T10:00:00.000Z',
        }),
        raw: true,
      });
      await helpers.createSingleRefund({ originalTxId: fullyRefundedExpense.id, refundTxId: fullRefundTx.id });

      const [partiallyRefundedExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2026-01-11T10:00:00.000Z',
        }),
        raw: true,
      });
      const [partialRefundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          transactionType: TRANSACTION_TYPES.income,
          time: '2026-01-21T10:00:00.000Z',
        }),
        raw: true,
      });
      await helpers.createSingleRefund({ originalTxId: partiallyRefundedExpense.id, refundTxId: partialRefundTx.id });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      // Refunds cancel the original spend and stay out of income: the fully refunded 2,000
      // clears, the partially refunded 1,000 leaves the 600 actually spent, and the 5,000
      // salary is the whole income side.
      expect(buckets[0]!.savings).toEqual({ income: 5000, expenses: 600, net: 4400 });
    });
  });

  describe('investment growth', () => {
    it('credits a price move to growth and leaves savings untouched', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // 10 shares held across the window: 100 -> 150 in Jan, then flat in Feb.
      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '150' });
      await setPrice({ securityId: security.id, date: FEB.end, price: '150' });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets[0]!.investments.priceEffect).toBe(500);
      expect(buckets[0]!.investments.growth).toBe(500);
      expect(buckets[0]!.savings.net).toBe(0);
      expect(buckets[1]!.investments.growth).toBe(0);
    });

    it('counts only the gain on bought shares, never the money spent buying them', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });
      // Mid-January: buy 5 more at 120, spending 600.
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2026-01-15',
          quantity: '5',
          price: '120',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '150' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // Holdings went 1,000 -> 2,250, but 600 of that was purchased, not earned:
      // 10 shares x 50 gain + 5 shares x 30 gain = 650.
      expect(buckets[0]!.investments.priceEffect).toBe(650);
      expect(buckets[0]!.investments.growth).toBe(650);
    });

    it('reports a market loss as negative growth', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '60' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets[0]!.investments.growth).toBe(-400);
    });

    it('splits a sale into recovered notional and its fee without inventing growth', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });
      // Mid-January: sell 5 of the 10 held at 150 with a 10 fee.
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          date: '2026-01-15',
          quantity: '5',
          price: '150',
          fees: '10',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '150' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // Holdings closed at 5 shares x 150 = 750, opened at 10 x 100 = 1,000. Adding
      // the 750 sale notional back leaves the market move on all 10 shares held into
      // the sale: 10 x (150 - 100) = 500. The 10 fee is the only drag, so growth is 490.
      expect(buckets[0]!.investments.priceEffect).toBe(500);
      expect(buckets[0]!.investments.feesAndTaxes).toBe(10);
      expect(buckets[0]!.investments.growth).toBe(490);
    });

    it('adds dividends to growth and subtracts standalone fees', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
          date: '2026-01-10',
          quantity: '10',
          price: '5',
          fees: '0',
        },
        raw: true,
      });
      // A standalone fee carries no notional: price 0 with the cost in `fees`,
      // so the stored amount is the fee itself. Quantity must still be non-zero
      // — the create endpoint rejects a zero quantity.
      const feeTx = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.fee,
          date: '2026-01-11',
          quantity: '1',
          price: '0',
          fees: '20',
        },
        raw: true,
      });
      // Fail here rather than 40 lines down: `raw: true` returns undefined on a
      // rejected payload, which would otherwise surface as a puzzling zero.
      expect(feeTx.id).toBeDefined();

      // Price flat, so growth is the dividend net of the fee alone.
      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '100' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets[0]!.investments.priceEffect).toBe(0);
      expect(buckets[0]!.investments.dividends).toBe(50);
      expect(buckets[0]!.investments.feesAndTaxes).toBe(20);
      expect(buckets[0]!.investments.growth).toBe(30);
    });

    it('treats an account-to-portfolio transfer as neither savings nor growth', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 5000 }),
        raw: true,
      });
      const portfolio = await helpers.createPortfolio({ raw: true });

      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: { accountId: account.id, amount: '1500', date: '2026-01-10' },
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      // The defining property of the report: moving your own cash into a
      // brokerage is not saving and not growth.
      expect(buckets[0]!.savings.net).toBe(0);
      expect(buckets[0]!.investments.growth).toBe(0);
    });
  });

  describe('composition', () => {
    it('reports holdings and cash levels at each period end', async () => {
      // Seeds the account side of the composition; asserted via cashValue below.
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 3000 }),
        raw: true,
      });
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1500', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '120' });

      const { buckets, degraded } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // 10 shares x 120.
      expect(buckets[0]!.composition.holdingsValue).toBe(1200);
      // 3,000 in the account plus the 500 of portfolio cash the buy left over.
      expect(buckets[0]!.composition.cashValue).toBe(3500);
      // `degraded` stays absent while every snapshot day has a price and every amount
      // is already in the base currency.
      expect(degraded).toBeUndefined();
    });

    it('counts uninvested portfolio cash on the cash side', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '800', date: '2026-01-05' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets[0]!.composition.holdingsValue).toBe(0);
      expect(buckets[0]!.composition.cashValue).toBe(800);
    });

    it('carries holdings and cash forward into a period with no activity', async () => {
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 3000 }),
        raw: true,
      });
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1500', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // Price moves in January, then holds flat through February with no trades
      // and no cash movement in the second period.
      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '120' });
      await setPrice({ securityId: security.id, date: FEB.end, price: '120' });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets).toHaveLength(2);
      // February is inactive, so its close must equal January's: 10 x 120 held, plus
      // 3,000 in the account and the 500 of portfolio cash the buy left over.
      expect(buckets[1]!.composition.holdingsValue).toBe(1200);
      expect(buckets[1]!.composition.cashValue).toBe(3500);
      // A flat, trade-free period grows by nothing.
      expect(buckets[1]!.investments.growth).toBe(0);
    });

    it('excludes a disabled portfolio whether or not the filter names it', async () => {
      const security = await createBaseCurrencySecurity();

      const enabledPortfolio = await helpers.createPortfolio({ raw: true });
      await seedHolding({ portfolioId: enabledPortfolio.id, securityId: security.id });
      await fundPortfolio({ portfolioId: enabledPortfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: enabledPortfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      const disabledPortfolio = await helpers.createPortfolio({ raw: true });
      await seedHolding({ portfolioId: disabledPortfolio.id, securityId: security.id });
      await fundPortfolio({ portfolioId: disabledPortfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: disabledPortfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '5',
          price: '100',
          fees: '0',
        },
        raw: true,
      });
      await helpers.updatePortfolio({
        portfolioId: disabledPortfolio.id,
        payload: { isEnabled: false },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '120' });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // Only the enabled portfolio's 10 shares are valued at 120. The disabled
      // portfolio would add 5 x 120 = 600 to holdings and its 500 of leftover cash
      // to the cash side had it counted — both are absent, proving the enabled one
      // still counts and the disabled one is dropped whole.
      expect(buckets[0]!.composition.holdingsValue).toBe(1200);
      expect(buckets[0]!.composition.cashValue).toBe(0);

      // Naming the disabled portfolio in `portfolioIds` must not bring it back.
      const named = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [enabledPortfolio.id, disabledPortfolio.id],
        raw: true,
      });

      expect(named.buckets[0]!.composition.holdingsValue).toBe(1200);
    }, 60_000);

    it('excludes vehicle and loan accounts from cash while a credit-card negative stays in', async () => {
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Checking', initialBalance: 4000 }),
        raw: true,
      });
      // A credit card carries what you owe: cash is a net position, so its negative
      // balance drags the cash side down rather than being dropped as "not liquid".
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          name: 'Card',
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: -500,
        }),
        raw: true,
      });
      // Vehicles and loans belong to other slices of the net-worth chart, so the
      // report's cash side must never pull their values in.
      await helpers.createVehicle({
        name: 'Family car',
        currencyCode: global.BASE_CURRENCY_CODE,
        make: 'Toyota',
        model: 'Corolla',
        year: 2021,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25000,
        purchaseDate: '2025-06-15',
        raw: true,
      });
      await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          name: 'Mortgage',
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 10000,
          originalPrincipal: 10000,
          startDate: '2025-06-15',
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets[0]!.composition.holdingsValue).toBe(0);
      // 4,000 in checking net of the 500 owed on the card. The 25,000 vehicle and
      // the 10,000 loan are excluded — either leaking in would throw this far off.
      expect(buckets[0]!.composition.cashValue).toBe(3500);
    });
  });

  describe('portfolio filter', () => {
    /**
     * Two enabled portfolios holding the same base-currency security: A with 10
     * shares, B with 5. Both open the window at 100 and close it at 120, so A alone
     * is 1,200 value / 200 growth, B alone is 600 / 100, and together 1,800 / 300 —
     * each combination is distinct enough to prove exactly which portfolios counted.
     */
    const seedTwoPortfolios = async () => {
      const security = await createBaseCurrencySecurity();

      const portfolioA = await helpers.createPortfolio({ raw: true });
      await seedHolding({ portfolioId: portfolioA.id, securityId: security.id });
      await fundPortfolio({ portfolioId: portfolioA.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolioA.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      const portfolioB = await helpers.createPortfolio({ raw: true });
      await seedHolding({ portfolioId: portfolioB.id, securityId: security.id });
      await fundPortfolio({ portfolioId: portfolioB.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolioB.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '5',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '120' });

      return { securityId: security.id, portfolioA, portfolioB };
    };

    it('scopes holdings and growth to the named portfolios and leaves savings whole', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 900,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });
      const { portfolioA, portfolioB } = await seedTwoPortfolios();
      const foreignId = generateRandomRecordId();

      const onlyA = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [portfolioA.id],
        raw: true,
      });

      // A's 10 shares valued at 120, grown from 100. B's 5 shares (600 value, 100
      // growth) are excluded, so holdings is 1,200 not the combined 1,800.
      expect(onlyA.buckets[0]!.composition.holdingsValue).toBe(1200);
      expect(onlyA.buckets[0]!.investments.growth).toBe(200);

      const onlyB = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [portfolioB.id],
        raw: true,
      });

      expect(onlyB.buckets[0]!.composition.holdingsValue).toBe(600);
      expect(onlyB.buckets[0]!.investments.growth).toBe(100);

      const noFilter = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // Both portfolios: 15 shares at 120, grown from 100.
      expect(noFilter.buckets[0]!.composition.holdingsValue).toBe(1800);
      expect(noFilter.buckets[0]!.investments.growth).toBe(300);

      const allNamed = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [portfolioA.id, portfolioB.id],
        raw: true,
      });

      // Naming every enabled portfolio is the same as naming none.
      expect(allNamed.buckets[0]!.composition.holdingsValue).toBe(1800);
      expect(allNamed.buckets[0]!.investments.growth).toBe(300);

      // A foreign id alongside an owned one is dropped by the DB intersect, so the
      // result is exactly A's slice — no other user's portfolio can widen it.
      const withForeign = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [portfolioA.id, foreignId],
        raw: true,
      });

      expect(withForeign.buckets[0]!.composition.holdingsValue).toBe(1200);
      expect(withForeign.buckets[0]!.investments.growth).toBe(200);

      // Filtering to nothing but a foreign id leaves an empty investment slice
      // rather than leaking data or erroring.
      const onlyForeign = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        portfolioIds: [foreignId],
      });

      expect(onlyForeign.statusCode).toBe(200);
      const onlyForeignData = helpers.extractResponse(onlyForeign);
      expect(onlyForeignData.buckets[0]!.composition.holdingsValue).toBe(0);
      expect(onlyForeignData.buckets[0]!.investments.growth).toBe(0);

      // Savings is income minus expenses across all of the user's accounts — it is
      // not attributable to a portfolio, so narrowing the investment filter leaves
      // it whole while still scoping holdings to A alone.
      expect(onlyA.buckets[0]!.savings.net).toBe(900);
      expect(onlyA.buckets[0]!.composition.holdingsValue).toBe(1200);
    }, 60_000);
  });

  describe('per-portfolio growth breakdown', () => {
    /**
     * Three named portfolios on one base-currency security priced 100 at the opening
     * snapshot, 120 at the end of January and 110 at the end of February:
     *  - Alpha holds 10 shares from before the window: +200 in Jan, -100 in Feb;
     *  - Beta holds 5: +100 in Jan, -50 in Feb;
     *  - Gamma buys 4 at 115 mid-February only: nothing in Jan, -20 in Feb.
     * Every number is distinct, so a slice landing on the wrong portfolio is visible.
     */
    const seedThreePortfolios = async () => {
      const security = await createBaseCurrencySecurity();

      const openPortfolio = async ({ name, quantity }: { name: string; quantity: string }) => {
        const portfolio = await helpers.createPortfolio({ payload: { name }, raw: true });
        await seedHolding({ portfolioId: portfolio.id, securityId: security.id });
        await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
        await helpers.createInvestmentTransaction({
          payload: {
            portfolioId: portfolio.id,
            securityId: security.id,
            category: INVESTMENT_TRANSACTION_CATEGORY.buy,
            date: '2025-12-20',
            quantity,
            price: '100',
            fees: '0',
          },
          raw: true,
        });
        return portfolio;
      };

      const alpha = await openPortfolio({ name: 'Alpha', quantity: '10' });
      const beta = await openPortfolio({ name: 'Beta', quantity: '5' });

      const gamma = await helpers.createPortfolio({ payload: { name: 'Gamma' }, raw: true });
      await seedHolding({ portfolioId: gamma.id, securityId: security.id });
      await fundPortfolio({ portfolioId: gamma.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: gamma.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2026-02-10',
          quantity: '4',
          price: '115',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: security.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: security.id, date: JAN.end, price: '120' });
      await setPrice({ securityId: security.id, date: FEB.end, price: '110' });

      return { alpha, beta, gamma };
    };

    it('splits each bucket growth across the portfolios that produced it and narrows to a filtered one', async () => {
      const { alpha, beta, gamma } = await seedThreePortfolios();

      const { buckets, portfolios } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      const january = buckets[0]!;
      const february = buckets[1]!;

      expect(january.investments.growth).toBe(300);
      expect(january.investments.byPortfolio).toEqual(
        expect.arrayContaining([
          { portfolioId: alpha.id, growth: 200 },
          { portfolioId: beta.id, growth: 100 },
        ]),
      );
      // Gamma bought nothing until February, so January carries no slice for it at
      // all rather than a zero one.
      expect(january.investments.byPortfolio).toHaveLength(2);

      expect(february.investments.growth).toBe(-170);
      expect(february.investments.byPortfolio).toEqual(
        expect.arrayContaining([
          { portfolioId: alpha.id, growth: -100 },
          { portfolioId: beta.id, growth: -50 },
          // 4 shares bought at 115 and worth 110 at the close: the loss on the new position.
          { portfolioId: gamma.id, growth: -20 },
        ]),
      );
      expect(february.investments.byPortfolio).toHaveLength(3);

      for (const bucket of buckets) {
        const sliceSum = bucket.investments.byPortfolio.reduce((sum, slice) => sum + slice.growth, 0);
        expect(sliceSum).toBe(bucket.investments.growth);
        expect(bucket.investments.byPortfolio.every((slice) => slice.growth !== 0)).toBe(true);
      }

      // Totals across the window: Alpha +100, Beta +50, Gamma -20 — ordered by how
      // far each moved, regardless of direction.
      expect(portfolios).toEqual([
        { portfolioId: alpha.id, name: 'Alpha' },
        { portfolioId: beta.id, name: 'Beta' },
        { portfolioId: gamma.id, name: 'Gamma' },
      ]);

      const narrowed = await helpers.getNetWorthDrivers({
        ...RANGE,
        portfolioIds: [alpha.id],
        raw: true,
      });

      expect(narrowed.portfolios).toEqual([{ portfolioId: alpha.id, name: 'Alpha' }]);
      // With one portfolio in scope the bucket total is that portfolio's slice —
      // the other two contribute to neither the split nor the total.
      expect(narrowed.buckets[0]!.investments.growth).toBe(200);
      expect(narrowed.buckets[0]!.investments.byPortfolio).toEqual([{ portfolioId: alpha.id, growth: 200 }]);
      expect(narrowed.buckets[1]!.investments.growth).toBe(-100);
      expect(narrowed.buckets[1]!.investments.byPortfolio).toEqual([{ portfolioId: alpha.id, growth: -100 }]);
    }, 60_000);
  });

  describe('degraded data quality', () => {
    it('reports a held security with no price data via degraded.unpricedSecurities', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // No price row exists for the held security anywhere in the window, so the
      // replay carries the 10 shares at cost and names the security as unpriced.
      const result = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      expect(result.degraded).toBeDefined();
      expect(result.degraded!.unpricedSecurities).toEqual([
        { securityId: security.id, symbol: 'EMAAR', name: 'Emaar Properties' },
      ]);
      // Base-currency holdings never cross an FX rate, so no currency degrades.
      expect(result.degraded!.fxFallbackCurrencies).toBeUndefined();
    });

    it('anchors a holding to its last pre-window price instead of collapsing to cost basis', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '1000', date: '2025-09-20' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-09-25',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // The security's only stored price predates the report window by months, and
      // no price exists inside it. The replay carries that last close forward as an
      // anchor rather than valuing the 10 shares at their 1,000 cost basis.
      await setPrice({ securityId: security.id, date: '2025-10-15', price: '150' });

      const result = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // 10 shares x 150 anchored, not the 10 x 100 cost basis.
      expect(result.buckets[0]!.composition.holdingsValue).toBe(1500);
      // A carried-forward anchor is a real price, so the holding is not reported as
      // unpriced and the report carries no data-quality caveat.
      expect(result.degraded).toBeUndefined();
    });
  });

  describe('currency conversion', () => {
    // ExchangeRates survives per-test truncation, so past-dated rows persisted by earlier
    // files can override the rates these tests seed. Clear the pair up to the end of the
    // range so each test starts with only its own rates.
    beforeEach(async () => {
      await ExchangeRates.destroy({
        where: {
          baseCode: API_LAYER_BASE_CURRENCY_CODE,
          quoteCode: global.BASE_CURRENCY_CODE,
          date: { [Op.lte]: new Date(`${FEB.end}T23:59:59.999Z`) },
        },
      });
    });

    // ExchangeRates is seed data and survives per-test truncation, and the global
    // cleanup only prunes today-or-later rows, so a historical rate seeded here would
    // leak into sibling tests. Remove the ones these tests add.
    afterEach(async () => {
      await ExchangeRates.destroy({
        where: {
          baseCode: API_LAYER_BASE_CURRENCY_CODE,
          quoteCode: global.BASE_CURRENCY_CODE,
          date: { [Op.between]: [new Date('2025-12-01T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z')] },
        },
      });
    });

    it('values a foreign-currency holding through the USD-pivot cross-rate, not 1:1', async () => {
      // Every other fixture prices in the base currency so the rate short-circuits to
      // 1; this pins the real cross-rate. 10 shares of a USD security at $120, with
      // USD->AED = 4, must read 4,800 AED — not the 1,200 a silent 1:1 fallback gives.
      const portfolio = await helpers.createPortfolio({ raw: true });
      const usdSecurity = await Securities.create({
        symbol: 'AAPL',
        providerSymbol: 'AAPL',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Apple Inc.',
      });
      await seedHolding({ portfolioId: portfolio.id, securityId: usdSecurity.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: usdSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '120',
          fees: '0',
        },
        raw: true,
      });

      // Flat $120 across both boundaries so the level, not a price move, is under test.
      await setPrice({ securityId: usdSecurity.id, date: '2025-12-31', price: '120' });
      await setPrice({ securityId: usdSecurity.id, date: JAN.end, price: '120' });

      // 1 USD = 4 AED, seeded inside the report's rate-fetch window so the per-day
      // walk carries it forward to Jan 31.
      await ExchangeRates.create({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: global.BASE_CURRENCY_CODE,
        rate: 4,
        date: new Date('2025-12-31T00:00:00.000Z'),
      });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // 10 shares x $120 x 4 AED/USD.
      expect(buckets[0]!.composition.holdingsValue).toBe(4800);
    });

    it('flags a currency with no rate as a 1:1 fallback in degraded.fxFallbackCurrencies', async () => {
      // The USD holding is priced but no USD->AED rate exists, so it converts at a 1:1
      // placeholder (10 x $120 x 1 = 1,200) and the currency is named in `degraded` so
      // the user knows the figure is not final.
      const portfolio = await helpers.createPortfolio({ raw: true });
      const usdSecurity = await Securities.create({
        symbol: 'MSFT',
        providerSymbol: 'MSFT',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Microsoft',
      });
      await seedHolding({ portfolioId: portfolio.id, securityId: usdSecurity.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: usdSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '120',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: usdSecurity.id, date: '2025-12-31', price: '120' });
      await setPrice({ securityId: usdSecurity.id, date: JAN.end, price: '120' });

      // A rate stored after the window would be borrowed as the earliest known rate,
      // so every USD->base rate is removed for the report call and put back after it.
      const baseRatesWhere = { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: global.BASE_CURRENCY_CODE };
      const storedBaseRates = (await ExchangeRates.findAll({ where: baseRatesWhere, raw: true })).map(
        ({ baseCode, quoteCode, date, rate, source }) => ({ baseCode, quoteCode, date, rate, source }),
      );
      await ExchangeRates.destroy({ where: baseRatesWhere });

      try {
        const { buckets, degraded } = await helpers.getNetWorthDrivers({
          from: JAN.start,
          to: JAN.end,
          granularity: 'monthly',
          raw: true,
        });

        // Priced, but valued at the 1:1 placeholder rather than a real cross-rate.
        expect(buckets[0]!.composition.holdingsValue).toBe(1200);
        expect(degraded).toBeDefined();
        expect(degraded!.fxFallbackCurrencies).toContain('USD');
      } finally {
        await ExchangeRates.bulkCreate(storedBaseRates, { ignoreDuplicates: true });
      }
    });

    it('values a boundary dated before the first stored rate at that rate and flags the currency', async () => {
      const portfolio = await helpers.createPortfolio({ raw: true });
      const usdSecurity = await Securities.create({
        symbol: 'GOOGL',
        providerSymbol: 'GOOGL',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Alphabet',
      });
      await seedHolding({ portfolioId: portfolio.id, securityId: usdSecurity.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: usdSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '120',
          fees: '0',
        },
        raw: true,
      });

      await setPrice({ securityId: usdSecurity.id, date: '2025-12-31', price: '120' });
      await setPrice({ securityId: usdSecurity.id, date: JAN.end, price: '120' });

      // A USD->base rate dated on or before Dec 31 would give the opening boundary a
      // real rate, so every USD->base rate is removed for the report call and put back after it.
      const baseRatesWhere = { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: global.BASE_CURRENCY_CODE };
      const storedBaseRates = (await ExchangeRates.findAll({ where: baseRatesWhere, raw: true })).map(
        ({ baseCode, quoteCode, date, rate, source }) => ({ baseCode, quoteCode, date, rate, source }),
      );
      await ExchangeRates.destroy({ where: baseRatesWhere });

      try {
        await ExchangeRates.create({ ...baseRatesWhere, rate: 4, date: new Date(`${JAN.end}T00:00:00.000Z`) });

        const { buckets, degraded } = await helpers.getNetWorthDrivers({
          from: JAN.start,
          to: JAN.end,
          granularity: 'monthly',
          raw: true,
        });

        // 10 shares x $120 x 4 AED/USD at both boundaries. A 1:1 opening boundary
        // would read 1,200 and report the 3,600 difference as growth.
        expect(buckets[0]!.composition.holdingsValue).toBe(4800);
        expect(buckets[0]!.investments.priceEffect).toBe(0);
        expect(buckets[0]!.investments.growth).toBe(0);
        expect(degraded).toBeDefined();
        expect(degraded!.fxFallbackCurrencies).toContain('USD');
      } finally {
        await ExchangeRates.destroy({ where: baseRatesWhere });
        await ExchangeRates.bulkCreate(storedBaseRates, { ignoreDuplicates: true });
      }
    });

    it('compounds a price move with an FX move on a foreign holding', async () => {
      // Both the price and the rate move inside the window, so the reported growth
      // is the combined effect, not either one alone.
      const portfolio = await helpers.createPortfolio({ raw: true });
      const usdSecurity = await Securities.create({
        symbol: 'NVDA',
        providerSymbol: 'NVDA',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Nvidia',
      });
      await seedHolding({ portfolioId: portfolio.id, securityId: usdSecurity.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: usdSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // Price climbs $100 -> $150 and USD strengthens 4 -> 5 AED across January.
      await setPrice({ securityId: usdSecurity.id, date: '2025-12-31', price: '100' });
      await setPrice({ securityId: usdSecurity.id, date: JAN.end, price: '150' });
      await ExchangeRates.bulkCreate([
        {
          baseCode: API_LAYER_BASE_CURRENCY_CODE,
          quoteCode: global.BASE_CURRENCY_CODE,
          rate: 4,
          date: new Date('2025-12-31T00:00:00.000Z'),
        },
        {
          baseCode: API_LAYER_BASE_CURRENCY_CODE,
          quoteCode: global.BASE_CURRENCY_CODE,
          rate: 5,
          date: new Date('2026-01-31T00:00:00.000Z'),
        },
      ]);

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // Opening 10 x $100 x 4 = 4,000; closing 10 x $150 x 5 = 7,500. The buy sits
      // before the window, so the whole 3,500 move is price effect with no
      // contribution mixed in.
      expect(buckets[0]!.composition.holdingsValue).toBe(7500);
      expect(buckets[0]!.investments.priceEffect).toBe(3500);
      expect(buckets[0]!.investments.growth).toBe(3500);
    });

    it('carries a fractional quantity and an ugly rate through the decimal-to-cents pipeline', async () => {
      // Non-round inputs on every axis catch rounding drift the flat-number
      // fixtures cannot: 3.7 shares, a $123.45 price, and a 3.6725 cross-rate.
      const portfolio = await helpers.createPortfolio({ raw: true });
      const usdSecurity = await Securities.create({
        symbol: 'TSLA',
        providerSymbol: 'TSLA',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Tesla',
      });
      await seedHolding({ portfolioId: portfolio.id, securityId: usdSecurity.id });

      await fundPortfolio({ portfolioId: portfolio.id, amount: '2000', date: '2025-12-15' });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: usdSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-12-20',
          quantity: '3.7',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // Price and rate both flat, so the level under test is a pure valuation.
      await setPrice({ securityId: usdSecurity.id, date: '2025-12-31', price: '123.45' });
      await setPrice({ securityId: usdSecurity.id, date: JAN.end, price: '123.45' });
      await ExchangeRates.create({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: global.BASE_CURRENCY_CODE,
        rate: 3.6725,
        date: new Date('2025-12-31T00:00:00.000Z'),
      });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: JAN.start,
        to: JAN.end,
        granularity: 'monthly',
        raw: true,
      });

      // 3.7 x 123.45 x 3.6725 = 1,677.469..., which the replay floors to whole base
      // units before the cents round-trip: floor(1,677.469) = 1,677.
      expect(buckets[0]!.composition.holdingsValue).toBe(1677);
      // Flat price and rate across the window leave no fabricated growth.
      expect(buckets[0]!.investments.priceEffect).toBe(0);
      expect(buckets[0]!.investments.growth).toBe(0);
    });
  });

  describe('granularity', () => {
    it('rolls the same transactions into one yearly bucket', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 600,
          transactionType: TRANSACTION_TYPES.income,
          time: `${FEB.start}T10:00:00.000Z`,
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({ ...RANGE, granularity: 'yearly', raw: true });

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.savings.income).toBe(1000);
    });

    it('splits a range into quarterly buckets', async () => {
      const { buckets } = await helpers.getNetWorthDrivers({
        from: '2026-01-01',
        to: '2026-06-30',
        granularity: 'quarterly',
        raw: true,
      });

      expect(buckets).toHaveLength(2);
      expect(buckets[0]!.periodStart).toBe('2026-01-01');
      expect(buckets[1]!.periodStart).toBe('2026-04-01');
    });

    it('clamps the first and last bucket to a range that starts and ends mid-month', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Before the range start — must be excluded despite sharing January.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 999,
          transactionType: TRANSACTION_TYPES.income,
          time: '2026-01-10T10:00:00.000Z',
        }),
        raw: true,
      });
      // Inside the clamped first bucket.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.income,
          time: '2026-01-20T10:00:00.000Z',
        }),
        raw: true,
      });
      // Inside the clamped last bucket.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: '2026-02-05T10:00:00.000Z',
        }),
        raw: true,
      });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: '2026-01-15',
        to: '2026-02-10',
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets).toHaveLength(2);
      // First bucket opens at the requested start, not the calendar-month start.
      expect(buckets[0]!.periodStart).toBe('2026-01-15');
      expect(buckets[0]!.periodEnd).toBe('2026-01-31');
      // Last bucket closes at the requested end, not the calendar-month end.
      expect(buckets[1]!.periodStart).toBe('2026-02-01');
      expect(buckets[1]!.periodEnd).toBe('2026-02-10');
      // The Jan 10 income predates the range start, so it never enters the first bucket.
      expect(buckets[0]!.savings.income).toBe(1000);
      expect(buckets[1]!.savings.income).toBe(500);
    });
  });

  describe('empty states', () => {
    it('returns zeroed buckets for a user with no data', async () => {
      const { buckets, portfolios } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets).toHaveLength(2);
      expect(buckets[0]!.savings).toEqual({ income: 0, expenses: 0, net: 0 });
      expect(buckets[0]!.investments).toEqual({
        growth: 0,
        priceEffect: 0,
        dividends: 0,
        feesAndTaxes: 0,
        byPortfolio: [],
      });
      expect(buckets[0]!.composition).toEqual({ holdingsValue: 0, cashValue: 0 });
      expect(portfolios).toEqual([]);
    });

    it('reports savings with zero growth for a user with no portfolios', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 900,
          transactionType: TRANSACTION_TYPES.income,
          time: `${JAN.start}T10:00:00.000Z`,
        }),
        raw: true,
      });

      const { buckets, portfolios } = await helpers.getNetWorthDrivers({ ...RANGE, raw: true });

      expect(buckets[0]!.savings.net).toBe(900);
      expect(buckets[0]!.investments.growth).toBe(0);
      expect(buckets[0]!.composition.holdingsValue).toBe(0);
      // Nothing to attribute growth to, so both the split and the legend stay empty
      // rather than being absent from the response.
      expect(buckets.every((bucket) => bucket.investments.byPortfolio.length === 0)).toBe(true);
      expect(portfolios).toEqual([]);
    });
  });

  describe('validation', () => {
    it('rejects malformed query parameters with 422', async () => {
      const unknownGranularity = await helpers.makeRequest({
        method: 'get',
        url: `/stats/net-worth-drivers?from=${JAN.start}&to=${FEB.end}&granularity=weekly`,
      });

      expect(unknownGranularity.statusCode).toBe(422);

      const malformedDate = await helpers.makeRequest({
        method: 'get',
        url: `/stats/net-worth-drivers?from=not-a-date&to=${FEB.end}&granularity=monthly`,
      });

      expect(malformedDate.statusCode).toBe(422);

      const invertedRange = await helpers.getNetWorthDrivers({
        from: FEB.end,
        to: JAN.start,
        granularity: 'monthly',
      });

      expect(invertedRange.statusCode).toBe(422);

      const missingGranularity = await helpers.makeRequest({
        method: 'get',
        url: `/stats/net-worth-drivers?from=${JAN.start}&to=${FEB.end}`,
      });

      expect(missingGranularity.statusCode).toBe(422);
    });
  });
});
