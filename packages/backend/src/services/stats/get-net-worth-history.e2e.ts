import {
  ACCOUNT_CATEGORIES,
  ASSET_CLASS,
  DEPRECIATION_PRESET,
  INVESTMENT_TRANSACTION_CATEGORY,
  type NetWorthHistoryGranularity,
  type RecordId,
  SECURITY_PROVIDER,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { until } from '@common/helpers';
import { afterEach, describe, expect, it } from '@jest/globals';
import Balances from '@models/balances.model';
import ExchangeRates from '@models/exchange-rates.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { Op } from 'sequelize';

const formatDay = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * Security priced in the user's base currency, so `getExchangeRate` short-circuits
 * to 1 and the portfolio-value test below asserts the report's math rather than an
 * FX cross-rate. Mirrors the equivalent fixture in get-net-worth-drivers.e2e.ts.
 */
const createBaseCurrencySecurity = async () =>
  Securities.create({
    symbol: 'EMAAR',
    providerSymbol: 'EMAAR',
    currencyCode: global.BASE_CURRENCY.code,
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
 * a row that then shifts the price assertion below and reads as a math bug.
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

describe('[Stats] Net worth history', () => {
  describe('GET /stats/net-worth-history', () => {
    it('returns per-kind liabilities, assets and net worth with carry-forward across monthly buckets', async () => {
      const monthTwoAgoStart = startOfMonth(subMonths(new Date(), 2));
      const monthOneAgoStart = startOfMonth(subMonths(new Date(), 1));
      const from = formatDay(monthTwoAgoStart);
      const to = formatDay(new Date());

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });
      // Move the creation-day balance row to the range start so the first month
      // reads the opening 1000 and later months carry balances forward from it.
      await Balances.update({ date: monthTwoAgoStart }, { where: { accountId: account.id } });

      // Income at the start of last month: month-2 still reads 1000, month-1
      // onward reads 1500.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: monthOneAgoStart.toISOString(),
        }),
        raw: true,
      });

      const creditCard = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 0,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: creditCard.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      // Loan currency must match the base currency so ref amounts stay 1:1.
      await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY.code,
          initialBalance: 200_000,
        }),
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(3);
      expect(result.points.map((point) => point.date)).toEqual([
        formatDay(endOfMonth(monthTwoAgoStart)),
        formatDay(endOfMonth(monthOneAgoStart)),
        to,
      ]);

      const [monthTwoAgo, monthOneAgo, current] = result.points;

      expect(monthTwoAgo!.assetsTotal).toBe(1000);
      expect(monthTwoAgo!.assets.cash).toBe(1000);
      expect(monthTwoAgo!.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-500);
      expect(monthTwoAgo!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-200_000);
      expect(monthTwoAgo!.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(0);
      expect(monthTwoAgo!.liabilitiesTotal).toBe(-200_500);
      expect(monthTwoAgo!.netWorth).toBe(-199_500);

      // A month with no transactions still shows the carried balances.
      expect(monthOneAgo!.assetsTotal).toBe(1500);
      expect(monthOneAgo!.assets.cash).toBe(1500);
      expect(monthOneAgo!.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-500);
      expect(monthOneAgo!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-200_000);
      expect(monthOneAgo!.liabilitiesTotal).toBe(-200_500);
      expect(monthOneAgo!.netWorth).toBe(-199_000);

      expect(current!.assetsTotal).toBe(1500);
      expect(current!.assets.cash).toBe(1500);
      expect(current!.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-500);
      expect(current!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-200_000);
      expect(current!.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(0);
      expect(current!.liabilitiesTotal).toBe(-200_500);
      expect(current!.netWorth).toBe(-199_000);
    });

    it('returns all-zero points for the whole range when the user has no data', async () => {
      const from = formatDay(startOfMonth(subMonths(new Date(), 2)));
      const to = formatDay(new Date());

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(3);
      for (const point of result.points) {
        expect(point.assetsTotal).toBe(0);
        expect(point.assets.cash).toBe(0);
        expect(point.assets.investments).toBe(0);
        expect(point.assets.vehicles).toBe(0);
        expect(point.assets.ventures).toBe(0);
        expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(0);
        expect(point.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(0);
        expect(point.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(0);
        expect(point.liabilitiesTotal).toBe(0);
        expect(point.netWorth).toBe(0);
      }
    });

    it('rejects an inverted range, an unknown granularity and an over-capacity bucket count with 422', async () => {
      const invertedRange = await helpers.getNetWorthHistory({
        from: '2024-02-01',
        to: '2024-01-01',
        granularity: 'monthly',
      });
      const unknownGranularity = await helpers.getNetWorthHistory({
        from: '2024-01-01',
        to: '2024-03-01',
        granularity: 'hourly' as NetWorthHistoryGranularity,
      });
      // ~730 weekly buckets over 14 years — past the 500 cap.
      const tooManyBuckets = await helpers.getNetWorthHistory({
        from: '2010-01-01',
        to: '2024-01-01',
        granularity: 'weekly',
      });

      expect(invertedRange.statusCode).toBe(422);
      expect(unknownGranularity.statusCode).toBe(422);
      expect(tooManyBuckets.statusCode).toBe(422);
    }, 60_000);

    it('excludes excludeFromStats credit-card accounts from liabilities', async () => {
      const from = formatDay(startOfMonth(new Date()));
      const to = formatDay(new Date());

      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const creditCard = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 0,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: creditCard.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.updateAccount({
        id: creditCard.id,
        payload: { excludeFromStats: true },
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(1);
      const point = result.points[0]!;
      expect(point.assetsTotal).toBe(1000);
      expect(point.assets.cash).toBe(1000);
      expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(0);
      expect(point.liabilitiesTotal).toBe(0);
      expect(point.netWorth).toBe(1000);
    });

    it('splits mixed credit cards per account: owing card stays a liability, positive card counts as an asset', async () => {
      const from = formatDay(startOfMonth(new Date()));
      const to = formatDay(new Date());

      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const owingCard = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 0,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: owingCard.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const positiveCard = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.creditCard,
          initialBalance: 0,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: positiveCard.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(1);
      const point = result.points[0]!;
      expect(point.assetsTotal).toBe(1300);
      expect(point.assets.cash).toBe(1300);
      expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-500);
      expect(point.liabilitiesTotal).toBe(-500);
      expect(point.netWorth).toBe(800);
    });

    it('includes a priced portfolio holding in assets and adds uninvested portfolio cash on top of it', async () => {
      // Fixed past window: December 2025 is already fully elapsed, so the single
      // bucket is never the in-progress "current" one and the price is deterministic.
      const from = '2025-12-01';
      const to = '2025-12-31';

      const portfolio = await helpers.createPortfolio({ raw: true });
      const security = await createBaseCurrencySecurity();
      await seedHolding({ portfolioId: portfolio.id, securityId: security.id });

      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '1000', currencyCode: global.BASE_CURRENCY.code, date: '2025-11-15' },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-11-20',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });
      // The 1000 deposit exactly funds the buy, leaving no uninvested cash, so the
      // whole point value is the 10-share holding priced at the bucket-end close.
      await setPrice({ securityId: security.id, date: to, price: '150' });

      const funded = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(funded.points).toHaveLength(1);
      const fundedPoint = funded.points[0]!;
      expect(fundedPoint.assetsTotal).toBe(1500);
      expect(fundedPoint.assets.investments).toBe(1500);
      expect(fundedPoint.assets.cash).toBe(0);
      expect(fundedPoint.netWorth).toBe(1500);

      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '500', currencyCode: global.BASE_CURRENCY.code, date: '2025-12-10' },
        raw: true,
      });

      const withCash = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(withCash.points).toHaveLength(1);
      const withCashPoint = withCash.points[0]!;
      // `investments` carries 10 shares @ 150 = 1500 plus the 500 uninvested portfolio cash.
      expect(withCashPoint.assets.investments).toBe(2000);
      expect(withCashPoint.assets.cash).toBe(0);
      expect(withCashPoint.assetsTotal).toBe(2000);
      expect(withCashPoint.netWorth).toBe(2000);
    }, 60_000);

    it('folds an overdrawn deposit account and an owing overdraft account into one overdraft liability, keeping cash non-negative', async () => {
      const from = formatDay(startOfMonth(new Date()));
      const to = formatDay(new Date());

      // A plain deposit account holding the user's own funds.
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      // A second deposit account overdrawn into the negative by an expense.
      const overdrawnDeposit = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 0 }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: overdrawnDeposit.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const overdraftAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          accountCategory: ACCOUNT_CATEGORIES.overdraft,
          initialBalance: 0,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: overdraftAccount.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(1);
      const point = result.points[0]!;
      // `cash` sums only the positive accounts. Both owed balances land in the single
      // overdraft kind; there is no separate bucket for an overdrawn plain account.
      expect(point.assets.cash).toBe(1000);
      expect(point.assetsTotal).toBe(1000);
      expect(point.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(-400);
      expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(0);
      expect(point.liabilitiesTotal).toBe(-400);
      expect(point.netWorth).toBe(600);
    }, 60_000);

    it('backfills a loan payoff dated on the anchor day without rewriting earlier buckets', async () => {
      const monthTwoAgoStart = startOfMonth(subMonths(new Date(), 2));
      const from = formatDay(monthTwoAgoStart);
      const to = formatDay(new Date());

      // Loan currency must match the base currency so ref amounts stay 1:1.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY.code,
          initialBalance: 200_000,
          originalPrincipal: 200_000,
        }),
        raw: true,
      });

      const sourceAccount = await helpers.createAccount({ raw: true });

      // A loan's balance anchor defaults to its creation day (today) — the same
      // day as the range's last bucket. Paying it off in full on that day must
      // fold the anchor row toward zero without rewriting earlier buckets, which
      // back-fill from the loan's immutable opening balance instead.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 200_000,
            time: `${to}T12:00:00.000Z`,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 200_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(3);
      const [monthTwoAgo, monthOneAgo, current] = result.points;

      // Earlier buckets still read the loan's opening balance, untouched by the payoff.
      expect(monthTwoAgo!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-200_000);
      expect(monthOneAgo!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-200_000);
      // Only the anchor-day (last) bucket folds the payoff in.
      expect(current!.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(0);
    });

    it('includes a vehicle at its purchase-anchored value in assets', async () => {
      const from = formatDay(startOfMonth(new Date()));
      const to = formatDay(new Date());

      await helpers.createVehicle({
        name: 'Test car',
        currencyCode: global.BASE_CURRENCY.code,
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25_000,
        purchaseDate: '2020-01-01',
        // A flat 0% custom rate keeps the vehicle at its purchase price for the
        // life of the fixture, so the asserted value is exact rather than riding
        // a depreciation curve.
        depreciationPreset: DEPRECIATION_PRESET.custom,
        customAnnualRatePct: 0,
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(1);
      const point = result.points[0]!;
      expect(point.assetsTotal).toBe(25_000);
      expect(point.assets.vehicles).toBe(25_000);
      expect(point.assets.cash).toBe(0);
      expect(point.netWorth).toBe(25_000);
    });

    it('includes a venture deal at its principal in the ventures asset kind', async () => {
      const from = formatDay(startOfMonth(new Date()));
      const to = formatDay(new Date());

      // A single deal with no entry fee values at its principal on and after the
      // investment date; base-currency so no FX cross-rate muddies the assertion.
      await helpers.createVentureDeal({
        payload: {
          currencyCode: global.BASE_CURRENCY.code,
          principal: '10000',
          entryFeePct: '0',
          investmentDate: from,
        },
        raw: true,
      });

      const result = await helpers.getNetWorthHistory({ from, to, granularity: 'monthly', raw: true });

      expect(result.points).toHaveLength(1);
      const point = result.points[0]!;
      // The ventures kind had no real-data coverage before — prove the deal lands
      // in `assets.ventures` (and net worth), not silently zero or another kind.
      expect(point.assets.ventures).toBe(10000);
      expect(point.assets.cash).toBe(0);
      expect(point.assetsTotal).toBe(10000);
      expect(point.netWorth).toBe(10000);
    });

    describe('currency conversion', () => {
      const tradeDay = '2025-11-10';
      const firstRateDay = '2025-12-15';
      const lastSeededDay = '2025-12-31';

      // ExchangeRates survives per-test truncation, so the base-currency rates this
      // block seeds (and any that transaction writes persist) must be removed by hand.
      const clearBaseCurrencyRatesThroughLastSeededDay = () =>
        ExchangeRates.destroy({
          where: {
            baseCode: API_LAYER_BASE_CURRENCY_CODE,
            quoteCode: global.BASE_CURRENCY.code,
            date: { [Op.lte]: new Date(`${lastSeededDay}T23:59:59.999Z`) },
          },
        });

      afterEach(clearBaseCurrencyRatesThroughLastSeededDay);

      /**
       * 10 shares of a USD security at a flat $100, with USD->base coverage starting
       * on `firstRateDay` (4) and moving to 5 on `lastSeededDay`. Flat price, so only
       * the rate differs between snapshot days.
       */
      const seedUsdHoldingWithLateRateCoverage = async () => {
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

        // The writes below convert USD into the base currency on the trade day, so a
        // rate must exist for it. It is wiped before the report runs.
        await ExchangeRates.bulkCreate(
          [
            {
              baseCode: API_LAYER_BASE_CURRENCY_CODE,
              quoteCode: global.BASE_CURRENCY.code,
              rate: 1,
              date: new Date(`${tradeDay}T00:00:00.000Z`),
            },
          ],
          { ignoreDuplicates: true },
        );

        // Fund the buy in its own settlement currency so USD cash nets to zero and
        // `assets.investments` is the holding alone.
        await helpers.directCashTransaction({
          portfolioId: portfolio.id,
          payload: { type: 'deposit', amount: '1000', currencyCode: 'USD', date: tradeDay },
          raw: true,
        });
        await helpers.createInvestmentTransaction({
          payload: {
            portfolioId: portfolio.id,
            securityId: usdSecurity.id,
            category: INVESTMENT_TRANSACTION_CATEGORY.buy,
            date: tradeDay,
            quantity: '10',
            price: '100',
            fees: '0',
          },
          raw: true,
        });

        await setPrice({ securityId: usdSecurity.id, date: '2025-11-30', price: '100' });
        await setPrice({ securityId: usdSecurity.id, date: lastSeededDay, price: '100' });

        await clearBaseCurrencyRatesThroughLastSeededDay();
        await ExchangeRates.bulkCreate([
          {
            baseCode: API_LAYER_BASE_CURRENCY_CODE,
            quoteCode: global.BASE_CURRENCY.code,
            rate: 4,
            date: new Date(`${firstRateDay}T00:00:00.000Z`),
          },
          {
            baseCode: API_LAYER_BASE_CURRENCY_CODE,
            quoteCode: global.BASE_CURRENCY.code,
            rate: 5,
            date: new Date(`${lastSeededDay}T00:00:00.000Z`),
          },
        ]);
      };

      it('converts a snapshot dated before the first stored rate at that first rate and still reports the currency as degraded', async () => {
        await seedUsdHoldingWithLateRateCoverage();

        const result = await helpers.getNetWorthHistory({
          from: '2025-11-01',
          to: '2025-12-31',
          granularity: 'monthly',
          raw: true,
        });

        expect(result.points).toHaveLength(2);
        // Nov 30 predates every stored rate: 10 x $100 at the first rate (4), not 1:1 (1,000).
        expect(result.points[0]!.assets.investments).toBe(4000);
        // Dec 31 has its own rate: 10 x $100 x 5.
        expect(result.points[1]!.assets.investments).toBe(5000);
        expect(result.degraded).toEqual({ fxFallbackCurrencies: ['USD'] });
      }, 60_000);

      it('converts a window that ends before the first stored rate at that first rate and still reports the currency as degraded', async () => {
        await seedUsdHoldingWithLateRateCoverage();

        // The whole window, including the week of rate lookback before it, predates
        // `firstRateDay`, so no rate is stored on or before any snapshot day.
        const result = await helpers.getNetWorthHistory({
          from: '2025-11-01',
          to: '2025-11-30',
          granularity: 'monthly',
          raw: true,
        });

        expect(result.points).toHaveLength(1);
        // 10 x $100 at the first stored rate (4), not 1:1 (1,000).
        expect(result.points[0]!.assets.investments).toBe(4000);
        expect(result.degraded).toEqual({ fxFallbackCurrencies: ['USD'] });
      }, 60_000);
    });
  });
});
