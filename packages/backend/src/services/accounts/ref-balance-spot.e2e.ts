import { TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { format, startOfDay, subDays } from 'date-fns';

/**
 * `refCurrentBalance` is a SPOT measure: the account's native balance converted
 * at the latest exchange rate. Transaction `refAmount`s keep their historical
 * tx-date rates (flows); the account-level ref balance must not accumulate them
 * (stock). These tests pin both sides of that split, plus the two re-anchoring
 * triggers: the daily rate sync and custom-rate edits.
 */

// A fixed historical date with its own exact rates for BOTH cross-rate legs, so
// historical tx conversions use a rate very different from the mocked "today"
// basket (EUR→AED: 7.0 historical vs ~3.87 today).
const HISTORICAL_DATE = subDays(startOfDay(new Date()), 5);
const HISTORICAL_EUR_PER_USD = 0.5;
const HISTORICAL_AED_PER_USD = 3.5;
const HISTORICAL_EUR_TO_AED = HISTORICAL_AED_PER_USD / HISTORICAL_EUR_PER_USD; // 7.0
const SPOT_EUR_TO_AED = AED_PER_USD / EUR_PER_USD; // ~3.86883

const seedHistoricalRates = async () => {
  // ExchangeRates is keyed on (baseCode, quoteCode, date) and is not truncated between tests, so
  // clear this date first — another file seeding the same fixture would make the insert throw.
  await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date = :date`, {
    replacements: { date: HISTORICAL_DATE },
  });

  await connection.sequelize.query(
    `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
     VALUES ('USD', 'EUR', :date, :eurRate, 'api-layer'), ('USD', 'AED', :date, :aedRate, 'api-layer')`,
    {
      replacements: { date: HISTORICAL_DATE, eurRate: HISTORICAL_EUR_PER_USD, aedRate: HISTORICAL_AED_PER_USD },
    },
  );
};

const createEurAccount = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
  return helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
    raw: true,
  });
};

/** EUR account with a credit limit whose ref side is left stale, as a previous day's rate would. */
const createEurCreditAccount = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'EUR', creditLimit: 1000 }),
    raw: true,
  });
  await connection.sequelize.query(`UPDATE "Accounts" SET "refCreditLimit" = 1 WHERE "id" = :id`, {
    replacements: { id: account.id },
  });
  return account;
};

describe('Account ref balances are spot measures', () => {
  afterEach(async () => {
    // ExchangeRates is a seed table (not truncated between tests) and the global
    // beforeEach only clears today+future rows – drop this file's historical
    // fixture rows so they can't leak into other tests on the same worker.
    await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date = :date`, {
      replacements: { date: HISTORICAL_DATE },
    });
  });

  it('converts refCurrentBalance at the latest rate while the tx refAmount keeps its historical rate', async () => {
    const account = await createEurAccount();
    await seedHistoricalRates();

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
        time: HISTORICAL_DATE.toISOString(),
      }),
      raw: true,
    });

    // The flow keeps its historical tx-date rate…
    expect(Number(tx.refAmount)).toEqualRefValue(100 * HISTORICAL_EUR_TO_AED);

    // …while the stock is measured at the latest rate.
    const updated = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(updated.currentBalance)).toBe(100);
    expect(Number(updated.refCurrentBalance)).toEqualRefValue(100 * SPOT_EUR_TO_AED);
  });

  it('remeasures stored ref balances when the rate sync runs', async () => {
    const account = await createEurAccount();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const beforeSync = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(beforeSync.refCurrentBalance)).toEqualRefValue(100 * SPOT_EUR_TO_AED);

    // Overnight rate move: EUR weakens against USD in the stored basket. The
    // stored balance must NOT react on its own – only the sync's remeasure pass
    // re-anchors it.
    const newEurPerUsd = 0.75;
    await connection.sequelize.query(
      `UPDATE "ExchangeRates" SET rate = :rate
       WHERE "baseCode" = 'USD' AND "quoteCode" = 'EUR' AND date >= :today`,
      { replacements: { rate: newEurPerUsd, today: startOfDay(new Date()) } },
    );

    const stillStale = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(stillStale.refCurrentBalance)).toEqualRefValue(100 * SPOT_EUR_TO_AED);

    await expect(helpers.syncExchangeRates().then((r) => r.statusCode)).resolves.toBe(200);

    const remeasured = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(remeasured.refCurrentBalance)).toEqualRefValue(100 * (AED_PER_USD / newEurPerUsd));
  });

  it('restamps refInitialBalance at the earliest-transaction date rate when backdated transactions land', async () => {
    // Account created with a nonzero opening balance: stamped at today's rate.
    await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 200 }),
      raw: true,
    });
    expect(Number(account.refInitialBalance)).toEqualRefValue(200 * SPOT_EUR_TO_AED);

    await seedHistoricalRates();

    // A backdated transaction moves the ledger boundary into the past – the
    // opening balance now semantically exists before that date, so its ref stamp
    // must use the boundary date's rate.
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
        time: HISTORICAL_DATE.toISOString(),
      }),
      raw: true,
    });

    const restamped = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(restamped.refInitialBalance)).toEqualRefValue(200 * HISTORICAL_EUR_TO_AED);

    // Deleting the earliest transaction moves the boundary back to the account's
    // creation date – the stamp returns to (approximately) today's rate.
    await helpers.deleteTransaction({ id: tx.id });
    const reverted = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(reverted.refInitialBalance)).toEqualRefValue(200 * SPOT_EUR_TO_AED);
  });

  it("pins today's net-worth history point to zero when the native balance nets to zero (chart matches the card)", async () => {
    const account = await createEurAccount();
    await seedHistoricalRates();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
        time: HISTORICAL_DATE.toISOString(),
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: startOfDay(new Date()).toISOString(),
      }),
      raw: true,
    });

    // The account card reads zero (spot of a zero native balance).
    const updated = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(updated.currentBalance)).toBe(0);
    expect(Number(updated.refCurrentBalance)).toBe(0);

    // The net-worth chart's latest point must agree: today's Balances row is a
    // stock pinned to that same spot value, not the historical-rate accumulator
    // (money in at 7.0, out at ~3.87) that would leave a ~313 AED residue.
    const history = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
    const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
    const todayRow = history.find((row) => format(new Date(row.date), 'yyyy-MM-dd') === todayKey);
    expect(todayRow).toBeDefined();
    expect(Number(todayRow!.amount)).toBe(0);
  });

  it("pins today's net-worth history point to the remeasured spot value after a custom rate edit", async () => {
    const account = await createEurAccount();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    await helpers.updateUserCurrency({
      currency: { currencyCode: 'EUR', liveRateUpdate: false },
      raw: true,
    });
    const res = await helpers.editCurrencyExchangeRate({
      pairs: [
        { baseCode: 'EUR', quoteCode: 'AED', rate: 5 },
        { baseCode: 'AED', quoteCode: 'EUR', rate: 0.2 },
      ],
    });
    expect(res.statusCode).toBe(200);

    // The remeasure re-anchors the card to 100 EUR × 5 = 500 AED…
    const remeasured = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(remeasured.refCurrentBalance)).toBe(500);

    // …and the chart's today point must move with it.
    const history = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
    const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
    const todayRow = history.find((row) => format(new Date(row.date), 'yyyy-MM-dd') === todayKey);
    expect(todayRow).toBeDefined();
    expect(Number(todayRow!.amount)).toBe(500);
  });

  it("does not pin a loan's today Balances row when the rate sync remeasures, while a normal cross-currency account IS re-pinned", async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });

    // Control: a normal cross-currency (EUR) system account. Creating it with an
    // income tx at the market rate comprehensively fetches today's basket, so the
    // sync below remeasures against our manually-moved rate rather than re-fetching.
    const control = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: control.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    // Cross-currency loan. Its Balances history is owned by `recomputeLoanBalance`'s
    // destroy+rebuild replay (historical-rate legs), never a spot pin — the remeasure
    // must leave its rows alone.
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: 'EUR',
        originalPrincipal: 10_000,
        initialBalance: 8_000,
      }),
      raw: true,
    });

    const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
    const findToday = (rows: Array<{ date: string | Date; amount: unknown }>) =>
      rows.find((row) => format(new Date(row.date), 'yyyy-MM-dd') === todayKey);

    const loanTodayBefore = findToday(await helpers.getBalanceHistory({ accountId: loan.id, raw: true }));
    expect(loanTodayBefore).toBeDefined();

    // Overnight EUR move in the stored basket.
    const newEurPerUsd = 0.75;
    await connection.sequelize.query(
      `UPDATE "ExchangeRates" SET rate = :rate WHERE "baseCode" = 'USD' AND "quoteCode" = 'EUR' AND date >= :today`,
      { replacements: { rate: newEurPerUsd, today: startOfDay(new Date()) } },
    );

    await expect(helpers.syncExchangeRates().then((r) => r.statusCode)).resolves.toBe(200);

    const loanTodayAfter = findToday(await helpers.getBalanceHistory({ accountId: loan.id, raw: true }));
    const controlTodayAfter = findToday(await helpers.getBalanceHistory({ accountId: control.id, raw: true }));

    // The loan's today row is untouched by the remeasure — its replay value stands…
    expect(Number(loanTodayAfter!.amount)).toBe(Number(loanTodayBefore!.amount));
    // …while the normal cross-currency account's today row IS re-pinned to the new spot.
    expect(Number(controlTodayAfter!.amount)).toEqualRefValue(100 * (AED_PER_USD / newEurPerUsd));
  });

  it('re-measures refCurrentBalance, refInitialBalance, and today’s row to spot when the balance is PATCHed after the rate diverged', async () => {
    // Non-base (EUR) system account opened at the market rate with a nonzero opening.
    await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 200 }),
      raw: true,
    });

    await seedHistoricalRates();

    // Backdated income pushes the ledger boundary into the past, so refInitialBalance
    // restamps at the historical (7.0) rate. currentBalance: 200 opening + 100 = 300.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
        time: HISTORICAL_DATE.toISOString(),
      }),
      raw: true,
    });

    // Today's EUR rate diverges after the account already exists.
    const newEurPerUsd = 0.75;
    const SPOT_B = AED_PER_USD / newEurPerUsd;
    await connection.sequelize.query(
      `UPDATE "ExchangeRates" SET rate = :rate WHERE "baseCode" = 'USD' AND "quoteCode" = 'EUR' AND date >= :today`,
      { replacements: { rate: newEurPerUsd, today: startOfDay(new Date()) } },
    );

    // PATCH currentBalance 300 -> 500 (no adjustment tx): the diff absorbs into the
    // opening balance (200 -> 400) and every ref side re-derives, none delta-shifts.
    await helpers.updateAccount({ id: account.id, payload: { currentBalance: 500 }, raw: true });

    const patched = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(patched.currentBalance)).toBe(500);
    // refCurrentBalance is the SPOT of the new native balance at rate B (500 * B),
    // not the pre-PATCH ref (300 at the market rate) plus a delta.
    expect(Number(patched.refCurrentBalance)).toEqualRefValue(500 * SPOT_B);
    // refInitialBalance is the new opening (400) restamped at the boundary (7.0) rate.
    expect(Number(patched.refInitialBalance)).toEqualRefValue(400 * HISTORICAL_EUR_TO_AED);

    // Today's net-worth row must equal the new spot too.
    const history = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
    const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
    const todayRow = history.find((row) => format(new Date(row.date), 'yyyy-MM-dd') === todayKey);
    expect(todayRow).toBeDefined();
    expect(Number(todayRow!.amount)).toEqualRefValue(500 * SPOT_B);
  });

  it('keeps ref balances identical to native balances for base-currency accounts', async () => {
    const account = await helpers.createAccount({ raw: true });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 123.45,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const updated = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(updated.currentBalance)).toBe(123.45);
    expect(Number(updated.refCurrentBalance)).toBe(123.45);
  });

  it('deletes a transaction even when no exchange rate is available (native write succeeds, ref kept stale)', async () => {
    const account = await createEurAccount();

    // Rates exist here → the income tx stamps refCurrentBalance at the spot rate.
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const beforeDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(beforeDelete.currentBalance)).toBe(100);
    expect(Number(beforeDelete.refCurrentBalance)).toEqualRefValue(100 * SPOT_EUR_TO_AED);

    // Simulate a total FX-data gap for EUR: drop every stored USD-pivot row that
    // could convert EUR, on any date (the global beforeEach only clears
    // today+future). ExchangeRates is a seed table shared across tests on this
    // worker, so snapshot the rows first and re-insert them in `finally`.
    const [eurRates] = (await connection.sequelize.query(
      `SELECT "baseCode", "quoteCode", "date", "rate", "source"
       FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`,
    )) as [Array<Record<string, unknown>>, unknown];

    try {
      await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`);

      // Deleting the tx fires the balance hook, whose spot remeasure now throws.
      // The native write must still succeed; the ref side keeps its stale value.
      const deleteResponse = await helpers.deleteTransaction({ id: tx.id });
      expect(deleteResponse.statusCode).toBe(200);

      const afterDelete = await helpers.getAccount({ id: account.id, raw: true });
      // Native balance returned to zero…
      expect(Number(afterDelete.currentBalance)).toBe(0);
      // …while refCurrentBalance is kept at its pre-delete (now stale) value, not
      // recomputed — the daily rate sync re-anchors it once a rate exists.
      expect(Number(afterDelete.refCurrentBalance)).toBe(Number(beforeDelete.refCurrentBalance));
    } finally {
      for (const row of eurRates) {
        await connection.sequelize.query(
          `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
           VALUES (:baseCode, :quoteCode, :date, :rate, :source)`,
          { replacements: row },
        );
      }
    }
  });

  // The card and stats net the two ref fields, so a limit left at an earlier
  // day's rate shows up as a phantom base-currency balance.
  describe('refCreditLimit is re-measured at the same rate as refCurrentBalance', () => {
    it('when a transaction moves the balance', async () => {
      const account = await createEurCreditAccount();

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.refCreditLimit)).toEqualRefValue(1000 * SPOT_EUR_TO_AED);
    });

    it('when the balance is edited directly', async () => {
      const account = await createEurCreditAccount();

      await helpers.updateAccount({ id: account.id, payload: { currentBalance: 500 }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.refCreditLimit)).toEqualRefValue(1000 * SPOT_EUR_TO_AED);
    });

    it('when the opening balance is edited', async () => {
      const account = await createEurCreditAccount();

      await helpers.updateAccount({ id: account.id, payload: { initialBalance: 500 }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.refCreditLimit)).toEqualRefValue(1000 * SPOT_EUR_TO_AED);
    });

    it('when only the credit limit is edited, refCurrentBalance included', async () => {
      const account = await createEurCreditAccount();
      await helpers.updateAccount({ id: account.id, payload: { currentBalance: 100 }, raw: true });
      await connection.sequelize.query(`UPDATE "Accounts" SET "refCurrentBalance" = 1 WHERE "id" = :id`, {
        replacements: { id: account.id },
      });

      await helpers.updateAccount({ id: account.id, payload: { creditLimit: 2000 }, raw: true });

      const updated = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(updated.refCurrentBalance)).toEqualRefValue(100 * SPOT_EUR_TO_AED);
      expect(Number(updated.refCreditLimit)).toEqualRefValue(2000 * SPOT_EUR_TO_AED);
    });
  });
});
