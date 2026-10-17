import {
  ASSET_CLASS,
  EXCHANGE_RATE_PROVIDER_TYPE,
  INVESTMENT_TRANSACTION_CATEGORY,
  PROPERTY_TYPE,
  type RecordId,
  SECURITY_PROVIDER,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import Balances from '@models/balances.model';
import ExchangeRates from '@models/exchange-rates.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { format, subDays } from 'date-fns';
import { Op } from 'sequelize';

import { CombinedBalanceHistoryItem } from './get-combined-balance-history';

describe('[Stats] Combined balance history', () => {
  // `ExchangeRates` / `UserExchangeRates` survive test truncation (they are seed
  // data — see `SEED_DATA_TABLES`). Blocks below delete AED/EUR rows to force a
  // known conversion (or a 1:1 fallback). Those deletions would otherwise leak
  // into every later suite — e.g. portfolio-transfer tests that resolve `USD→AED`
  // for today on demand and would see it permanently missing once the source-gate
  // treats the date as already "comprehensive". Snapshot the AED/EUR rows on entry
  // and re-insert them on exit so deleted seed rows are put back. Restoring at the
  // FILE level (not per-describe) is deliberate: the venture/vehicle blocks rely on
  // the cleared state left by the cross-currency block, so the table must only be
  // healed after the whole file has run.
  const FX_SNAPSHOT_QUOTES = ['AED', 'EUR'];
  let fxSnapshot: {
    baseCode: string;
    quoteCode: string;
    date: Date;
    rate: number;
    source: EXCHANGE_RATE_PROVIDER_TYPE;
  }[] = [];
  let userFxSnapshot: { userId: number; baseCode: string; quoteCode: string; date: Date; rate: number }[] = [];

  beforeAll(async () => {
    fxSnapshot = (
      await ExchangeRates.findAll({
        where: { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: { [Op.in]: FX_SNAPSHOT_QUOTES } },
        raw: true,
      })
    ).map(({ baseCode, quoteCode, date, rate, source }) => ({ baseCode, quoteCode, date, rate, source }));
    userFxSnapshot = (await UserExchangeRates.findAll({ where: { userId: 1 }, raw: true })).map(
      ({ userId, baseCode, quoteCode, date, rate }) => ({ userId, baseCode, quoteCode, date, rate }),
    );
  });

  // Re-insert (ignoring still-present rows) rather than wipe-then-restore: a wipe
  // would also drop today-dated rows fetched mid-file, which is what later suites
  // need. This only puts back the seed rows this file deleted.
  afterAll(async () => {
    if (fxSnapshot.length > 0) {
      await ExchangeRates.bulkCreate(fxSnapshot, { ignoreDuplicates: true });
    }
    if (userFxSnapshot.length > 0) {
      await UserExchangeRates.bulkCreate(userFxSnapshot, { ignoreDuplicates: true });
    }
  });

  // Shared by the cross-currency and cash-balance describes.
  // `ExchangeRates` survives test truncation (seed data — see
  // `SEED_DATA_TABLES`), so any test that seeds AED/EUR rows leaves them visible
  // to the next test unless wiped explicitly. `UserExchangeRates` is wiped for
  // the default user (`userId=1`) by the same call so per-user FX overrides don't
  // leak either.
  const FX_QUOTE_CODES_TOUCHED = ['AED', 'EUR'];
  const wipeFxState = async () => {
    await ExchangeRates.destroy({
      where: {
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: { [Op.in]: FX_QUOTE_CODES_TOUCHED },
      },
    });
    await UserExchangeRates.destroy({ where: { userId: 1 } });
  };

  it('Returns combined balance data for multiple accounts, with and without a date range', async () => {
    const accountA = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
      raw: true,
    });
    const accountB = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 2000 }),
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.income,
        time: subDays(new Date(), 3).toISOString(),
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.income,
        time: subDays(new Date(), 1).toISOString(),
      }),
      raw: true,
    });

    const data = await helpers.getCombinedBalanceHistory({ raw: true });

    expect(data.length).toBeGreaterThan(0);

    const record = data[0]!;
    expect(record).toHaveProperty('accountsBalance');
    expect(record).toHaveProperty('portfoliosBalance', 0);
    expect(record).toHaveProperty('venturesBalance', 0);
    expect(record).toHaveProperty('vehiclesBalance', 0);
    expect(record).toHaveProperty('loansBalance', 0);
    expect(record).toHaveProperty('totalBalance');
    expect(record.totalBalance).toBe(
      record.accountsBalance +
        record.portfoliosBalance +
        record.venturesBalance +
        record.vehiclesBalance +
        record.loansBalance,
    );

    // Latest entry sums both accounts: 1,000 + 500 + 2,000 + 200.
    expect(data[data.length - 1]!.accountsBalance).toBeGreaterThan(3000);

    for (const entry of data) {
      expect(entry.loansBalance).toBe(0);
    }

    const ranged = await helpers.getCombinedBalanceHistory({
      from: format(subDays(new Date(), 4), 'yyyy-MM-dd'),
      to: format(subDays(new Date(), 2), 'yyyy-MM-dd'),
      raw: true,
    });

    expect(ranged.length).toBeGreaterThan(0);
    expect(ranged[0]).toHaveProperty('accountsBalance');
    expect(ranged[0]).toHaveProperty('portfoliosBalance', 0);
    expect(ranged[0]).toHaveProperty('totalBalance');
  }, 60_000);

  it('Returns empty array when no data exists', async () => {
    const data = await helpers.getCombinedBalanceHistory({ raw: true });
    expect(data).toEqual([]);
  });

  it('Validates date parameters', async () => {
    const response = await helpers.makeRequest({
      method: 'get',
      url: '/stats/combined-balance-history?from=invalid-date',
    });

    expect(response.statusCode).toBe(422);
  });

  it('Returns correct balance for today even when no Balance record exists for today', async () => {
    // Create an account (this auto-creates a Balance record for today)
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        initialBalance: 1000,
      }),
      raw: true,
    });

    // Update the balance record's date to yesterday to simulate the scenario
    // where balance exists for yesterday but not for today
    const yesterday = subDays(new Date(), 1);
    yesterday.setHours(0, 0, 0, 0);

    await Balances.update({ date: yesterday }, { where: { accountId: account.id } });

    // Get combined balance history for a range that includes both yesterday and today
    const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const toDate = format(new Date(), 'yyyy-MM-dd');

    const data = await helpers.getCombinedBalanceHistory({
      from: fromDate,
      to: toDate,
      raw: true,
    });

    expect(data.length).toBeGreaterThan(0);

    const todayDate = toDate;
    const yesterdayDate = format(yesterday, 'yyyy-MM-dd');

    // Verify yesterday's entry exists with balance 1000
    const yesterdayEntry = data.find((item: CombinedBalanceHistoryItem) => item.date === yesterdayDate)!;
    expect(yesterdayEntry).toBeDefined();
    expect(yesterdayEntry.accountsBalance).toBe(1000);

    // Find today's entry - this is the key test
    const todayEntry = data.find((item: CombinedBalanceHistoryItem) => item.date === todayDate)!;

    // Today should have a balance entry (this is what's failing in production)
    expect(todayEntry).toBeDefined();

    // Today's balance should be 1000 (carried forward from yesterday)
    // This is the bug: it returns 0 instead of 1000
    expect(todayEntry.accountsBalance).toBe(1000);
    expect(todayEntry.totalBalance).toBe(1000);
  });

  it('Carries the pre-range balance up to the first in-range record instead of back-filling that record', async () => {
    // Balances rows are sparse: Account A held 8500 before the range and its
    // only in-range row is the drain to 0 at day -3. Days before day -3 must
    // read 8500; back-filling the day -3 value would hide the money on those
    // days and turn a same-day transfer into a one-sided step.
    //
    // We use API-created accounts (so amounts are stored correctly) and only
    // manipulate dates via Balances.update to avoid Money conversion issues.

    const accountA = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 8500 }),
      raw: true,
    });
    const accountB = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 2000 }),
      raw: true,
    });

    const day12Ago = subDays(new Date(), 12);
    const day10Ago = subDays(new Date(), 10);
    const day7Ago = subDays(new Date(), 7);
    const day3Ago = subDays(new Date(), 3);
    day12Ago.setHours(0, 0, 0, 0);
    day10Ago.setHours(0, 0, 0, 0);
    day7Ago.setHours(0, 0, 0, 0);
    day3Ago.setHours(0, 0, 0, 0);

    // Move Account A's balance record to day -10 (pre-range)
    await Balances.update({ date: day10Ago }, { where: { accountId: accountA.id } });

    // Account B's record sits exactly on the range start, so it must not be seeded.
    await Balances.update({ date: day7Ago }, { where: { accountId: accountB.id } });

    // Older zero rows for both: the seed is the LATEST pre-range row (A), and an
    // account with a row on the range start ignores its pre-range rows (B).
    await (Balances as any).create({ accountId: accountA.id, date: day12Ago, amount: 0 });
    await (Balances as any).create({ accountId: accountB.id, date: day12Ago, amount: 0 });

    // Create Account A's in-range record at day -3 with amount 0
    // (0 is safe from any Money conversion — 0 cents = $0 regardless)
    await (Balances as any).create({ accountId: accountA.id, date: day3Ago, amount: 0 });

    // Query range: last 7 days
    const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const toDate = format(new Date(), 'yyyy-MM-dd');

    const data = await helpers.getCombinedBalanceHistory({
      from: fromDate,
      to: toDate,
      raw: true,
    });

    expect(data.length).toBeGreaterThan(0);

    expect(data[0]!.date).toBe(fromDate);
    expect(data[0]!.accountsBalance).toBe(10500);

    const drainDate = format(day3Ago, 'yyyy-MM-dd');
    for (const entry of data) {
      expect(entry.accountsBalance).toBe(entry.date < drainDate ? 10500 : 2000);
    }
  });

  it('Correctly backfills accounts that have NO records in the range', async () => {
    // Account A has a balance record only before the range — it should be
    // backfilled at the start of the range and forward-filled throughout.
    const accountA = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 5000 }),
      raw: true,
    });

    // Move Account A's balance record to well before the range
    const preRangeDate = subDays(new Date(), 20);
    preRangeDate.setHours(0, 0, 0, 0);
    await Balances.update({ date: preRangeDate }, { where: { accountId: accountA.id } });

    // Query range: last 7 days (Account A has no records here at all)
    const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const toDate = format(new Date(), 'yyyy-MM-dd');

    const data = await helpers.getCombinedBalanceHistory({
      from: fromDate,
      to: toDate,
      raw: true,
    });

    expect(data.length).toBeGreaterThan(0);

    // Account A should be backfilled with $5000 across the entire range
    for (const entry of data) {
      expect(entry.accountsBalance).toBe(5000);
    }
  });

  describe('Portfolio crypto intraday bucketing', () => {
    it('collapses same-UTC-day SecurityPricing rows onto one daily bucket, latest timestamp wins', async () => {
      // Test strategy: compare two API calls against the same portfolio. The
      // first call has only the LATE intraday row (price 67000) seeded — that's
      // the expected daily-bucket value. The second call adds an EARLIER row
      // (price 50000) on the same UTC day. If the new bucketing logic works,
      // the late row still wins and both responses match. If bucketing broke
      // (e.g. early row overwrites the late one), the second response would
      // drop to the 50000-derived value. The investment transaction defaults
      // to currencyCode='USD' regardless of the security's currency, so the
      // exchange rate to AED applies in both calls and cancels out — we only
      // care that the LATE price won the bucket, not its absolute base-currency
      // value.
      const pickedDay = subDays(new Date(), 5);
      const pickedDayUtcMidnight = Date.UTC(
        pickedDay.getUTCFullYear(),
        pickedDay.getUTCMonth(),
        pickedDay.getUTCDate(),
      );
      const dayKey = format(new Date(pickedDayUtcMidnight), 'yyyy-MM-dd');

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto Portfolio' }),
        raw: true,
      });

      const cryptoSecurity = await Securities.create({
        symbol: 'BTC',
        providerSymbol: 'bitcoin',
        currencyCode: 'USD',
        cryptoCurrencyCode: 'BTC',
        providerName: SECURITY_PROVIDER.coingecko,
        assetClass: ASSET_CLASS.crypto,
        name: 'Bitcoin',
      });

      await helpers.createHolding({
        payload: { portfolioId: portfolio.id, securityId: cryptoSecurity.id },
      });

      // Drain any background sync from createHolding (it may also seed rows
      // via the new bucketing path) so the assertions below operate on
      // exactly the two rows we control.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: cryptoSecurity.id } });

      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: cryptoSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: dayKey,
          quantity: '1',
          price: '50000',
          fees: '0',
        },
        raw: true,
      });

      const fromDate = format(subDays(new Date(), 8), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      // Phase 1: only the 22:00 row exists — baseline expected value.
      await SecurityPricing.create({
        securityId: cryptoSecurity.id,
        date: new Date(pickedDayUtcMidnight + 22 * 60 * 60 * 1000),
        priceClose: '67000',
        source: SECURITY_PROVIDER.coingecko,
      });

      const baselineData = await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      });
      const baselineEntry = (baselineData as CombinedBalanceHistoryItem[]).find((e) => e.date === dayKey);
      expect(baselineEntry).toBeDefined();
      const baselinePortfolio = baselineEntry!.portfoliosBalance;

      // Phase 2: add an EARLIER intraday row on the same UTC day. With correct
      // bucketing (the new `formatDate(price.date)` key + last-write-wins on
      // `pricesBySecurityAndDate.set`), the late row still wins → same value.
      // With the OLD `String(price.date)` key, both rows would create distinct
      // keys none of which match the daily `targetDate`, so the value would
      // fall back to costBasis and diverge from baseline.
      await SecurityPricing.create({
        securityId: cryptoSecurity.id,
        date: new Date(pickedDayUtcMidnight + 6 * 60 * 60 * 1000),
        priceClose: '50000',
        source: SECURITY_PROVIDER.coingecko,
      });

      const bothData = await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      });
      const bothEntry = (bothData as CombinedBalanceHistoryItem[]).find((e) => e.date === dayKey);
      expect(bothEntry).toBeDefined();
      expect(bothEntry!.portfoliosBalance).toBe(baselinePortfolio);
    });
  });

  describe('Portfolio cross-currency conversion (USD-base ExchangeRates pivot)', () => {
    // Tests in this block need precise control over which rates exist when the
    // history endpoint runs, so `wipeFxState` runs BOTH before each test (to
    // clear any prior describe's leak) and inside `seedHoldingAndPriceHistory`
    // AFTER the investment-transaction insert (because `calculateRefAmount`
    // lazily fetches rates and stores them — without that second wipe, every
    // test would observe an unexpected USD→AED row).
    const seedHoldingAndPriceHistory = async ({
      portfolioId,
      securityId,
      pickedDay,
      dayKey,
      price = '100',
      cashCurrencyCode = 'USD',
    }: {
      portfolioId: string;
      securityId: string;
      pickedDay: Date;
      dayKey: string;
      price?: string;
      /** Settlement currency of the buy (= the security's currency); the buy is funded in it. */
      cashCurrencyCode?: string;
    }) => {
      await helpers.createHolding({ payload: { portfolioId, securityId } });
      // Drain any background sync from createHolding before clobbering the
      // single SecurityPricing row this test relies on.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId } });

      await SecurityPricing.create({
        securityId,
        date: pickedDay,
        priceClose: price,
        source: SECURITY_PROVIDER.yahoo,
      });

      // `createInvestmentTransaction` → `calculateRefAmount` resolves
      // `<securityCurrency> → AED (user base)` for `dayKey` through the real
      // `getExchangeRate`. Seed the USD-pivot legs up front so that resolve hits
      // a stored rate instead of a live provider fetch: once an earlier test has
      // made the date look "comprehensive", the on-demand fetch is skipped and an
      // absent rate throws — which would fail the holding setup, not the assertion.
      // These rows are ephemeral; the `wipeFxState()` below clears them before
      // each test seeds the rates it actually asserts on.
      await ExchangeRates.bulkCreate(
        [
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 1, date: pickedDay },
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'EUR', rate: 1, date: pickedDay },
        ],
        { ignoreDuplicates: true },
      );

      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId,
          securityId,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: dayKey,
          quantity: '1',
          price,
          fees: '0',
        },
        raw: true,
      });

      // portfoliosBalance sums holdings market value and portfolio cash, so the
      // buy above leaves a negative cash leg of `price` in settlement currency.
      // Deposit the same amount in the same currency to net that leg to zero;
      // otherwise the negative cash would exactly cancel the holding and every
      // FX assertion in this block would collapse to 0 — these tests must verify
      // holdings FX conversion in isolation.
      await helpers.directCashTransaction({
        portfolioId,
        payload: { type: 'deposit', amount: price, currencyCode: cashCurrencyCode, date: dayKey },
        raw: true,
      });

      // The transaction-create flow calls `calculateRefAmount`, which lazily
      // hits the live FX provider and writes a row to `ExchangeRates`. Wipe
      // that row so each test asserts only against the rates it explicitly
      // seeds in the lines that follow.
      await wipeFxState();
    };

    beforeEach(wipeFxState);
    // Leave the FX tables cleared after every test in this block: the venture and
    // vehicle blocks that follow rely on the cleared state (no stray USD-pivot rate
    // leaking a non-1:1 conversion into their base-currency assertions).
    afterEach(wipeFxState);

    it('converts USD security holdings into the user base currency via stored USD-pivot rates', async () => {
      // Regression guard for the case where `ExchangeRates` is queried as
      // `baseCode = securityCurrency, quoteCode = userBase` — rows are seeded
      // as `baseCode = USD, quoteCode = X` so that direction never matches and
      // the lookup silently falls back to 1:1. This test pins both the lookup
      // direction AND the cross-rate maths by asserting an exact converted
      // value: with USD→AED = 4 and a USD-denominated holding worth $100, the
      // portfolio balance must be 400 AED, NOT 100 AED.
      const pickedDay = subDays(new Date(), 3);
      pickedDay.setUTCHours(0, 0, 0, 0);
      const dayKey = format(pickedDay, 'yyyy-MM-dd');

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'USD Stocks' }),
        raw: true,
      });

      const usdSecurity = await Securities.create({
        symbol: 'AAPL',
        providerSymbol: 'AAPL',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Apple Inc.',
      });

      await seedHoldingAndPriceHistory({
        portfolioId: portfolio.id,
        securityId: usdSecurity.id,
        pickedDay,
        dayKey,
      });

      // Round-number rate so the assertion is exact: 1 USD = 4 AED.
      await ExchangeRates.create({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: 'AED',
        rate: 4,
        date: pickedDay,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(pickedDay, 1), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const entry = data.find((e) => e.date === dayKey);
      expect(entry).toBeDefined();
      // 1 share * $100 * 4 AED/USD = 400 AED. The API serializer returns
      // decimals (not cents), so 400 is the expected value over the wire.
      expect(entry!.portfoliosBalance).toBe(400);
    });

    it('walks back to a rate from BEFORE the fetch window when none exists inside it', async () => {
      // Regression (Sentry MONEY-MATTER-BACKEND-7B): the per-day rate walk only saw
      // rates preloaded inside [windowStart, windowEnd]. A currency whose latest rate
      // predates the window had no in-window row, so the walk found nothing and the
      // value silently collapsed to 1:1. The lookup now seeds one anchor from before
      // the window. Here USD→AED exists only 20 days ago while the loader's lower bound
      // is ~11 days ago, so without the pre-window anchor this would wrongly read 100.
      const pickedDay = subDays(new Date(), 3);
      pickedDay.setUTCHours(0, 0, 0, 0);
      const dayKey = format(pickedDay, 'yyyy-MM-dd');

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Pre-window walk-back portfolio' }),
        raw: true,
      });

      const usdSecurity = await Securities.create({
        symbol: 'NVDA',
        providerSymbol: 'NVDA',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'NVIDIA',
      });

      await seedHoldingAndPriceHistory({
        portfolioId: portfolio.id,
        securityId: usdSecurity.id,
        pickedDay,
        dayKey,
      });

      // Seed USD→AED ONLY 20 days ago — strictly before the loader's lower bound
      // (query window is day-4..today, so rates preload from ~day-11 onward).
      const preWindowDay = subDays(new Date(), 20);
      preWindowDay.setUTCHours(0, 0, 0, 0);
      await ExchangeRates.create({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: 'AED',
        rate: 4,
        date: preWindowDay,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(pickedDay, 1), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const entry = data.find((e) => e.date === dayKey);
      expect(entry).toBeDefined();
      // Pre-window anchor applied: 1 share * $100 * 4 AED/USD = 400 AED (not the 1:1 100).
      expect(entry!.portfoliosBalance).toBe(400);
    });

    it('prefers a UserExchangeRates override over the canonical USD-pivot rate', async () => {
      // System rate USD→AED = 4. User override (UserExchangeRates baseCode=USD,
      // quoteCode=AED) = 10. Override must win — this pins the precedence
      // through the real DB fetch (`buildUserRatesMap` short-circuiting the
      // USD-pivot cross-rate in `createGetExchangeRate`).
      const pickedDay = subDays(new Date(), 3);
      pickedDay.setUTCHours(0, 0, 0, 0);
      const dayKey = format(pickedDay, 'yyyy-MM-dd');

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Override portfolio' }),
        raw: true,
      });

      const usdSecurity = await Securities.create({
        symbol: 'GOOG',
        providerSymbol: 'GOOG',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Alphabet',
      });

      await seedHoldingAndPriceHistory({
        portfolioId: portfolio.id,
        securityId: usdSecurity.id,
        pickedDay,
        dayKey,
      });

      await ExchangeRates.create({
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: 'AED',
        rate: 4,
        date: pickedDay,
      });
      // UserExchangeRates is keyed on the global default user (userId=1 in the
      // integration setup). Insert directly so the test doesn't depend on the
      // edit-rate HTTP flow.
      await UserExchangeRates.create({
        userId: 1,
        baseCode: 'USD',
        quoteCode: 'AED',
        rate: 10,
        date: pickedDay,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(pickedDay, 1), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const entry = data.find((e) => e.date === dayKey);
      expect(entry).toBeDefined();
      // Override rate 10 wins -> 1 * 100 * 10 = 1000 AED.
      expect(entry!.portfoliosBalance).toBe(1000);
    });

    it('includes non-base portfolio CASH converted via the USD-pivot cross-rate', async () => {
      // Cash held inside a portfolio in a non-base currency must be converted to
      // the user base just like security holdings. EUR cash, user base AED:
      // USD→EUR = 2, USD→AED = 4 -> EUR→AED = 2, so €100 of cash = 200 AED. This
      // also guards the currency-set extension: EUR is not a security currency
      // here, so it only reaches the USD-pivot loader via the cash leg.
      const pickedDay = subDays(new Date(), 3);
      pickedDay.setUTCHours(0, 0, 0, 0);
      const dayKey = format(pickedDay, 'yyyy-MM-dd');
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'EUR cash portfolio' }),
        raw: true,
      });

      // Ephemeral rates so the deposit's ref-amount computation resolves (for both
      // the event date and `new Date()`); wiped immediately after so the assertion
      // runs only against the rates seeded below.
      await ExchangeRates.bulkCreate(
        [
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'EUR', rate: 1, date: pickedDay },
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 1, date: pickedDay },
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'EUR', rate: 1, date: today },
          { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 1, date: today },
        ],
        { ignoreDuplicates: true },
      );

      // The cash deposit converts EUR→AED at write time, and getExchangeRate
      // refuses to convert a currency the user isn't connected to. A security
      // holding would connect it implicitly; a bare cash deposit needs it here.
      await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });

      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '100', currencyCode: 'EUR', date: dayKey },
        raw: true,
      });

      await wipeFxState();

      await ExchangeRates.bulkCreate([
        { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'EUR', rate: 2, date: pickedDay },
        { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode: 'AED', rate: 4, date: pickedDay },
      ]);

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(pickedDay, 1), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const entry = data.find((e) => e.date === dayKey);
      expect(entry).toBeDefined();
      // €100 * (USD→AED 4 / USD→EUR 2) = 200 AED.
      expect(entry!.portfoliosBalance).toBe(200);
    });
  });

  describe('Venture deals', () => {
    it('reflects deal principal in venturesBalance from the investmentDate forward', async () => {
      const investmentDate = format(subDays(new Date(), 3), 'yyyy-MM-dd');
      await helpers.createVentureDeal({
        payload: {
          principal: '10000',
          entryFeePct: '0',
          investmentDate,
        },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const before = data.find((e) => e.date === format(subDays(new Date(), 4), 'yyyy-MM-dd'));
      expect(before).toBeDefined();
      expect(before!.venturesBalance).toBe(0);

      const after = data.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'));
      expect(after).toBeDefined();
      expect(after!.venturesBalance).toBe(10000);

      const autoRanged = (await helpers.getCombinedBalanceHistory({ raw: true })) as CombinedBalanceHistoryItem[];

      expect(autoRanged.length).toBeGreaterThan(0);
      const lastRecord = autoRanged[autoRanged.length - 1]!;
      expect(lastRecord.venturesBalance).toBe(10000);
      expect(lastRecord.totalBalance).toBe(
        lastRecord.accountsBalance + lastRecord.portfoliosBalance + lastRecord.venturesBalance,
      );
    }, 60_000);
  });

  describe('Vehicles in combined balance history', () => {
    const buildVehiclePayload = (overrides: Record<string, unknown> = {}) => ({
      name: 'Vehicle for history',
      currencyCode: global.BASE_CURRENCY_CODE,
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      vehicleClass: VEHICLE_CLASS.sedan,
      purchasePrice: 20000,
      // Purchase a few days ago, fully inside the seeded ExchangeRates window so
      // there's no missing-rate fallback even when the test currency is non-base.
      purchaseDate: format(subDays(new Date(), 4), 'yyyy-MM-dd'),
      ...overrides,
    });

    it('tracks vehiclesBalance from the purchase day onward and drops it once excluded from stats', async () => {
      // A non-vehicle account keeps the series non-empty. With the vehicle as the only
      // asset, excluding it returns `[]` and every vehiclesBalance assertion passes vacuously.
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      // Base-currency vehicle dodges all FX lookups — the depreciation curve
      // alone drives vehiclesBalance.
      const vehicle = await helpers.createVehicle({
        ...buildVehiclePayload(),
        raw: true,
      });

      const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      const data = (await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      expect(data.length).toBeGreaterThan(0);

      const purchaseDay = vehicle.purchaseDate;

      const prePurchase = data.filter((entry) => entry.date < purchaseDay);
      expect(prePurchase.length).toBeGreaterThan(0);
      for (const entry of prePurchase) {
        expect(entry.vehiclesBalance).toBe(0);
      }

      const postPurchase = data.filter((entry) => entry.date >= purchaseDay);
      expect(postPurchase.length).toBeGreaterThan(0);
      for (const entry of postPurchase) {
        expect(entry.vehiclesBalance).toBeGreaterThan(0);
        // Sanity: vehicle never appears richer than its purchase price.
        expect(entry.vehiclesBalance).toBeLessThanOrEqual(20000);
      }

      // Flip the vehicle account out of stats. `accountCategory` is omitted so
      // the controller's vehicle-category guard does not trip.
      const updateResponse = await helpers.updateAccount({
        id: vehicle.accountId,
        payload: { excludeFromStats: true },
      });
      expect(updateResponse.statusCode).toBe(200);

      const after = (await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      expect(after.length).toBeGreaterThan(0);
      // With the only vehicle excluded, vehiclesBalance must be 0 across the range.
      for (const entry of after) {
        expect(entry.vehiclesBalance).toBe(0);
      }
    }, 60_000);
  });

  describe('Properties in combined balance history', () => {
    const buildPropertyPayload = (overrides: Record<string, unknown> = {}) => ({
      name: 'Property for history',
      currencyCode: global.BASE_CURRENCY_CODE,
      address: '123 Example St',
      city: 'Boston',
      country: 'US',
      propertyType: PROPERTY_TYPE.house,
      purchasePrice: 20000,
      purchaseDate: format(subDays(new Date(), 4), 'yyyy-MM-dd'),
      annualAppreciationRatePct: 3,
      ...overrides,
    });

    it('tracks propertiesBalance from the purchase day onward and drops it once excluded from stats', async () => {
      await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const property = await helpers.createProperty({
        ...buildPropertyPayload(),
        raw: true,
      });

      const fromDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      const data = (await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      expect(data.length).toBeGreaterThan(0);

      const purchaseDay = property.purchaseDate;

      const prePurchase = data.filter((entry) => entry.date < purchaseDay);
      expect(prePurchase.length).toBeGreaterThan(0);
      for (const entry of prePurchase) {
        expect(entry.propertiesBalance).toBe(0);
      }

      const postPurchase = data.filter((entry) => entry.date >= purchaseDay);
      expect(postPurchase.length).toBeGreaterThan(0);
      for (const entry of postPurchase) {
        expect(entry.propertiesBalance).toBeGreaterThan(0);
        expect(entry.propertiesBalance).toBeLessThanOrEqual(30_000);
      }

      const updateResponse = await helpers.updateAccount({
        id: property.accountId,
        payload: { excludeFromStats: true },
      });
      expect(updateResponse.statusCode).toBe(200);

      const after = (await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      expect(after.length).toBeGreaterThan(0);
      for (const entry of after) {
        expect(entry.propertiesBalance).toBe(0);
      }
    }, 60_000);

    it('does not apply a revaluation on top of the latest persisted anchor', async () => {
      const property = await helpers.createProperty({
        ...buildPropertyPayload(),
        raw: true,
      });
      const targetValue = 30_000;

      await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue,
      });

      const today = format(new Date(), 'yyyy-MM-dd');
      const data = (await helpers.getCombinedBalanceHistory({
        from: today,
        to: today,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      expect(data.find((entry) => entry.date === today)?.propertiesBalance).toBeCloseTo(targetValue, 2);
    }, 60_000);
  });

  describe('Loans in combined balance history', () => {
    it('reports negative loansBalance and keeps it out of accountsBalance', async () => {
      const cash = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 50_000,
          originalPrincipal: 50_000,
        }),
        raw: true,
      });

      const fromDate = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      const toDate = format(new Date(), 'yyyy-MM-dd');

      const data = (await helpers.getCombinedBalanceHistory({
        from: fromDate,
        to: toDate,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const today = data.find((entry) => entry.date === toDate)!;
      expect(today).toBeDefined();

      // Outstanding loan balance is stored negative.
      expect(today.loansBalance).toBeLessThan(0);
      expect(Math.abs(today.loansBalance)).toBe(50_000);

      // The loan negative is routed into loansBalance, not accountsBalance.
      expect(today.accountsBalance).toBe(1000);

      // totalBalance sums all buckets algebraically: 1000 + (-50_000) = -49_000.
      expect(today.totalBalance).toBe(
        today.accountsBalance +
          today.portfoliosBalance +
          today.venturesBalance +
          today.vehiclesBalance +
          today.loansBalance,
      );
      expect(today.totalBalance).toBe(1000 - 50_000);

      // Only assert existence — these vars are otherwise unused, avoiding unused-var lint.
      expect(loan.id).toBeDefined();
      expect(cash.id).toBeDefined();
    });

    it('forward-fills loansBalance between anchor and payment days without touching accountsBalance', async () => {
      // Same-currency (base) setup so no FX conversion enters the assertions.
      const observerCash = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });
      const paymentSource = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 100_000 }),
        raw: true,
      });

      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 10_000,
          originalPrincipal: 10_000,
        }),
        raw: true,
      });

      // Move the balance anchor 6 days back so the loan owes 10,000 as-of then; the
      // loan's only Balances row starts at that date and forward-fills forward.
      const anchorDay = subDays(new Date(), 6);
      const anchorDate = format(anchorDay, 'yyyy-MM-dd');
      await helpers.updateLoan({
        id: loan.id,
        payload: { currentBalance: 10_000, currentBalanceAsOf: anchorDate },
        raw: true,
      });

      // A single 4,000 payment dated 3 days ago steps the outstanding to 6,000 and
      // writes a second Balances row on that day.
      const paymentDay = subDays(new Date(), 3);
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: paymentSource.id,
            amount: 4_000,
            time: paymentDay.toISOString(),
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 4_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: anchorDate,
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const byDate = (offset: number) => {
        const key = format(subDays(new Date(), offset), 'yyyy-MM-dd');
        const entry = data.find((item) => item.date === key);
        if (!entry) throw new Error(`Expected a combined-history entry for ${key}`);
        return entry;
      };

      // (a) Forward-fill: every day from the anchor up to (but excluding) the
      // payment day holds the full -10,000 outstanding, even on days with no row.
      expect(byDate(6).loansBalance).toBe(-10_000);
      expect(byDate(5).loansBalance).toBe(-10_000);
      expect(byDate(4).loansBalance).toBe(-10_000);

      // (b) The payment day steps the series down, and it forward-fills onward.
      expect(byDate(4).loansBalance).not.toBe(byDate(3).loansBalance);
      expect(byDate(3).loansBalance).toBe(-6_000);
      expect(byDate(0).loansBalance).toBe(-6_000);

      // (c) The loan's anchor/payment rows never leak into the cash partition: the
      // pre-payment window has no cash activity, so accountsBalance is identical
      // across it (a leaked loan anchor would have injected -10,000 on day -6).
      expect(byDate(6).accountsBalance).toBe(byDate(5).accountsBalance);
      expect(byDate(5).accountsBalance).toBe(byDate(4).accountsBalance);
      for (const entry of data) {
        // Cash stays comfortably positive; a leaked loan negative would drag it under.
        expect(entry.accountsBalance).toBeGreaterThan(0);
        expect(entry.totalBalance).toBe(
          entry.accountsBalance +
            entry.portfoliosBalance +
            entry.venturesBalance +
            entry.vehiclesBalance +
            entry.loansBalance,
        );
      }

      // Only assert existence — these vars are otherwise unused, avoiding unused-var lint.
      expect(observerCash.id).toBeDefined();
    });

    it('does not retroactively change a past day loansBalance when a payoff is recorded today', async () => {
      // The demo scenario: a loan is recorded today (balanceAnchorDate = today) with
      // 7,200 outstanding, then paid off the same day. A payment dated today must not
      // change what the loan owed on any prior day — history is immutable.
      const paymentSource = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 100_000 }),
        raw: true,
      });

      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 7_200,
          originalPrincipal: 7_200,
        }),
        raw: true,
      });

      const from = format(subDays(new Date(), 3), 'yyyy-MM-dd');
      const to = format(new Date(), 'yyyy-MM-dd');
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

      const before = (await helpers.getCombinedBalanceHistory({
        from,
        to,
        raw: true,
      })) as CombinedBalanceHistoryItem[];
      const loanOwedYesterdayBefore = before.find((e) => e.date === yesterday)!.loansBalance;

      // Full payoff dated today.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: paymentSource.id,
            amount: 7_200,
            time: new Date().toISOString(),
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 7_200,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const after = (await helpers.getCombinedBalanceHistory({
        from,
        to,
        raw: true,
      })) as CombinedBalanceHistoryItem[];
      const loanOwedYesterdayAfter = after.find((e) => e.date === yesterday)!.loansBalance;

      // Yesterday the loan owed 7,200 (stored negative); paying it off today cannot
      // change that. The bug: back-fill uses the anchor-day row, which the same-day
      // payoff folds to 0, so yesterday retroactively reads 0.
      expect(loanOwedYesterdayBefore).toBe(-7_200);
      expect(loanOwedYesterdayAfter).toBe(loanOwedYesterdayBefore);
    });
  });

  describe('Portfolio cash balance', () => {
    // Base-currency (AED) cash so getExchangeRate short-circuits to 1 and these
    // assertions stay exact without any FX seeding. `wipeFxState` runs anyway
    // so a future non-base test added to this block can't be polluted by an
    // ambient AED/EUR row left over from another describe.
    beforeEach(wipeFxState);

    it('reflects a direct cash deposit from the deposit day forward and extends the auto-range back to it', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Cash-only portfolio' }),
        raw: true,
      });

      const depositDay = format(subDays(new Date(), 10), 'yyyy-MM-dd');
      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '500', currencyCode: global.BASE_CURRENCY_CODE, date: depositDay },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 12), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      // Before the deposit: no cash in the portfolio.
      const beforeDeposit = data.find((e) => e.date === format(subDays(new Date(), 11), 'yyyy-MM-dd'));
      expect(beforeDeposit).toBeDefined();
      expect(beforeDeposit!.portfoliosBalance).toBe(0);

      // On and after the deposit day: cash is tracked in base currency.
      const onDeposit = data.find((e) => e.date === depositDay);
      expect(onDeposit).toBeDefined();
      expect(onDeposit!.portfoliosBalance).toBe(500);

      const today = data.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'))!;
      expect(today).toBeDefined();
      expect(today.portfoliosBalance).toBe(500);
      expect(today.totalBalance).toBe(
        today.accountsBalance + today.portfoliosBalance + today.venturesBalance + today.vehiclesBalance,
      );

      // Auto-range must count the oldest portfolio transfer. A cash-only portfolio has no
      // investment transactions and no venture deals, so minDate collapses to today and the
      // series returns a single point.
      const autoRanged = (await helpers.getCombinedBalanceHistory({ raw: true })) as CombinedBalanceHistoryItem[];

      expect(autoRanged.length).toBeGreaterThanOrEqual(10);
      expect(autoRanged[0]!.date <= depositDay).toBe(true);

      const autoOnDeposit = autoRanged.find((e) => e.date === depositDay);
      expect(autoOnDeposit).toBeDefined();
      expect(autoOnDeposit!.portfoliosBalance).toBe(500);

      const autoToday = autoRanged.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'));
      expect(autoToday!.portfoliosBalance).toBe(500);
    }, 60_000);

    it('does not smear post-window cash activity into a window that ends in the past', async () => {
      // Regression: `computePortfolioCashByDate` anchors on the CURRENT stored
      // cash, so cash rows must be fetched through today even when `to` is in
      // the past. If deltas between `to` and today were missing from the replay,
      // the seed `stored - sum(deltas)` would misattribute today's deposit as a
      // constant offset across every historical day (500 would read as 900),
      // and today's stored refTotalCash would be stamped onto the historical
      // `to` cell.
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Past-window portfolio' }),
        raw: true,
      });

      const inWindowDepositDay = format(subDays(new Date(), 5), 'yyyy-MM-dd');
      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '500', currencyCode: global.BASE_CURRENCY_CODE, date: inWindowDepositDay },
        raw: true,
      });
      // Second deposit dated TODAY — strictly after the requested window's `to`.
      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: {
          type: 'deposit',
          amount: '400',
          currencyCode: global.BASE_CURRENCY_CODE,
          date: format(new Date(), 'yyyy-MM-dd'),
        },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
        to: format(subDays(new Date(), 2), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      // Before the in-window deposit: no cash yet.
      const beforeDeposit = data.find((e) => e.date === format(subDays(new Date(), 6), 'yyyy-MM-dd'));
      expect(beforeDeposit).toBeDefined();
      expect(beforeDeposit!.portfoliosBalance).toBe(0);

      // From the deposit day through the window end: exactly 500 on every day —
      // today's 400 deposit and today's stored cash total (900) must not leak
      // backwards into the historical window.
      const fromDepositOnward = data.filter((e) => e.date >= inWindowDepositDay);
      expect(fromDepositOnward.length).toBeGreaterThan(0);
      for (const entry of fromDepositOnward) {
        expect(entry.portfoliosBalance).toBe(500);
      }
    });

    it('conserves total net worth when cash moves from an account into a portfolio', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Funded portfolio' }),
        raw: true,
      });

      const today = format(new Date(), 'yyyy-MM-dd');
      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: { accountId: account.id, amount: '300', date: today },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 2), 'yyyy-MM-dd'),
        to: today,
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const todayEntry = data.find((e) => e.date === today)!;
      expect(todayEntry).toBeDefined();
      // Cash left the account and now lives in the portfolio.
      expect(todayEntry.accountsBalance).toBe(700);
      expect(todayEntry.portfoliosBalance).toBe(300);
      // Net worth unchanged — moving cash into a portfolio must not make it vanish.
      expect(todayEntry.totalBalance).toBe(1000);
    });

    it('credits sell proceeds to portfoliosBalance on/after the sell day', async () => {
      // Pins `calculateCashDelta(sell)` -> positive settlement amount funneled
      // into the per-currency cash bucket. AED security so settlement is AED
      // and `getExchangeRate` short-circuits to 1 throughout.
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Sell-proceeds portfolio' }),
        raw: true,
      });

      const aedSecurity = await Securities.create({
        symbol: 'EMAAR',
        providerSymbol: 'EMAAR.AE',
        currencyCode: global.BASE_CURRENCY_CODE,
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Emaar Properties',
      });

      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: aedSecurity.id } });
      // Drain background syncHistoricalPrices then clear any rows it inserted so
      // every holding-value lookup falls back to costBasis deterministically.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: aedSecurity.id } });

      const fundingDay = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      const buyDay = format(subDays(new Date(), 5), 'yyyy-MM-dd');
      const sellDay = format(subDays(new Date(), 2), 'yyyy-MM-dd');

      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '1000', currencyCode: global.BASE_CURRENCY_CODE, date: fundingDay },
        raw: true,
      });

      // Buy 5 @ 100 -> settlementAmount 500, cashDelta -500. Holding qty=5, costBasis=500.
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: aedSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: buyDay,
          quantity: '5',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // Sell 5 @ 120 -> settlementAmount 600, cashDelta +600. Holding qty=0, costBasis=0.
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: aedSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          date: sellDay,
          quantity: '5',
          price: '120',
          fees: '0',
        },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 10), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      // Between buy and sell: cash 500 + holding costBasis 500 = 1000.
      const beforeSell = data.find((e) => e.date === format(subDays(new Date(), 3), 'yyyy-MM-dd'));
      expect(beforeSell).toBeDefined();
      expect(beforeSell!.portfoliosBalance).toBe(1000);

      // On sell day: cash 500 + 600 = 1100, holding cleared.
      const onSell = data.find((e) => e.date === sellDay);
      expect(onSell).toBeDefined();
      expect(onSell!.portfoliosBalance).toBe(1100);

      // Running balance carries forward.
      const today = data.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'));
      expect(today!.portfoliosBalance).toBe(1100);
    });

    it('reflects direct PortfolioBalances writes when no transactions or transfers were issued', async () => {
      // `PUT /investments/portfolios/:id/balance` writes `PortfolioBalances`
      // directly with no `InvestmentTransaction` / `PortfolioTransfers` audit row.
      // Replay must anchor to the stored cash so this channel is not invisible:
      // a pure direct-write of 750 AED has to appear as 750 today, not 0.
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Direct-write portfolio' }),
        raw: true,
      });

      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: global.BASE_CURRENCY_CODE,
        setAvailableCash: '750',
        setTotalCash: '750',
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const today = data.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'));
      expect(today).toBeDefined();
      expect(today!.portfoliosBalance).toBe(750);
    });

    it('combines direct PortfolioBalances writes with transaction-driven deltas without double-counting', async () => {
      // Reproduces the production bug: user funds IBKR via a direct balance
      // write (e.g. importer / manual seed), then buys securities. The buy
      // debits cash through `calculateCashDelta` while the stored cash row
      // already reflects the post-buy state. Replay must end at the stored
      // 200 today (seed 1000 + buy -800), not at -800.
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Direct-write + buy portfolio' }),
        raw: true,
      });

      const aedSecurity = await Securities.create({
        symbol: 'ALDAR',
        providerSymbol: 'ALDAR.AE',
        currencyCode: global.BASE_CURRENCY_CODE,
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Aldar Properties',
      });

      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: aedSecurity.id } });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: aedSecurity.id } });

      // Seed cash directly (simulates importer / manual adjustment) to 1000.
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: global.BASE_CURRENCY_CODE,
        setAvailableCash: '1000',
        setTotalCash: '1000',
        raw: true,
      });

      // Buy 8 @ 100 -> cash debit 800. updatePortfolioBalance is called by the
      // transaction service, leaving stored cash at 200 today.
      const buyDay = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: aedSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: buyDay,
          quantity: '8',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
        to: format(new Date(), 'yyyy-MM-dd'),
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      // Today: 200 stored cash + 800 cost-basis fallback for the holding = 1000.
      const today = data.find((e) => e.date === format(new Date(), 'yyyy-MM-dd'));
      expect(today).toBeDefined();
      expect(today!.portfoliosBalance).toBe(1000);
    });
  });

  describe('Portfolio pre-window price anchor', () => {
    it('values a holding priced only before the range at that price, not cost basis', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Pre-window anchor portfolio' }),
        raw: true,
      });

      const aedSecurity = await Securities.create({
        symbol: 'DEWA',
        providerSymbol: 'DEWA.AE',
        currencyCode: global.BASE_CURRENCY_CODE,
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Dubai Electricity and Water',
      });

      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: aedSecurity.id } });
      // Drain the background sync then clear its rows so the only stored price is
      // the pre-window anchor seeded below.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: aedSecurity.id } });

      // Fund then buy 10 @ 100 so the buy's -1,000 cash leg nets against the
      // deposit: portfolio cash is 0 and portfoliosBalance is the holding alone.
      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: { type: 'deposit', amount: '1000', currencyCode: global.BASE_CURRENCY_CODE, date: '2025-11-01' },
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: aedSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2025-11-02',
          quantity: '10',
          price: '100',
          fees: '0',
        },
        raw: true,
      });

      // The only stored price predates the requested range by months, with none
      // inside it. Replay carries that last close (150) forward as an anchor
      // rather than valuing the 10 shares at their 1,000 cost basis.
      await SecurityPricing.create({
        securityId: aedSecurity.id,
        date: new Date('2025-11-15T00:00:00.000Z'),
        priceClose: '150',
        source: SECURITY_PROVIDER.yahoo,
      });

      const data = (await helpers.getCombinedBalanceHistory({
        from: '2026-01-10',
        to: '2026-01-20',
        raw: true,
      })) as CombinedBalanceHistoryItem[];

      const entry = data.find((e) => e.date === '2026-01-20');
      expect(entry).toBeDefined();
      // 10 x 150 anchor + 0 cash, not the 10 x 100 = 1,000 cost basis.
      expect(entry!.portfoliosBalance).toBe(1500);
    });
  });
});
