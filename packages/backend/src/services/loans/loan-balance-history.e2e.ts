import { TRANSACTION_TRANSFER_NATURE, type RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, describe, expect, it } from '@jest/globals';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import { format, startOfDay, subDays } from 'date-fns';

const DAY_30_AGO = format(subDays(new Date(), 30), 'yyyy-MM-dd');
const DAY_20_AGO = format(subDays(new Date(), 20), 'yyyy-MM-dd');
const DAY_10_AGO = format(subDays(new Date(), 10), 'yyyy-MM-dd');
const TODAY = format(new Date(), 'yyyy-MM-dd');

/**
 * Base-currency loan (so refBalance == nominal balance and the Balances rows
 * can be asserted with exact numbers) plus a cash account to pay from.
 */
const setupLoanWithSource = async ({ initialBalance }: { initialBalance: number }) => {
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      currencyCode: global.BASE_CURRENCY_CODE,
      initialBalance,
      originalPrincipal: initialBalance,
    }),
    raw: true,
  });
  const sourceAccount = await helpers.createAccount({ raw: true });
  return { loan, sourceAccount };
};

/** Re-anchors `loan` to the same outstanding as-of the given past date. */
const reAnchorLoan = async ({ loanId, balance, asOf }: { loanId: string; balance: number; asOf: string }) =>
  helpers.updateLoan({
    id: loanId,
    payload: { currentBalance: balance, currentBalanceAsOf: asOf },
    raw: true,
  });

/** Pays `amount` into the loan, optionally back-dated. Returns the source expense leg. */
const payLoan = async ({
  loanId,
  sourceAccountId,
  amount,
  time,
  categoryId,
}: {
  loanId: string;
  sourceAccountId: RecordId;
  amount: number;
  time?: string;
  /** Category of the payment; defaults to the primary user's, so other users pass their own. */
  categoryId?: RecordId;
}) => {
  const [base] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: sourceAccountId,
        amount,
        ...(time ? { time } : {}),
        ...(categoryId ? { categoryId } : {}),
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loanId as RecordId,
    },
    raw: true,
  });
  return base;
};

/** Fetches the loan's Balances history rows normalized to `{ date, amount }`. */
const getLoanHistory = async ({ loanId }: { loanId: string }) => {
  const rows = await helpers.getBalanceHistory({
    accountId: loanId,
    raw: true,
  });
  return rows.map((row) => ({
    date: format(new Date(row.date), 'yyyy-MM-dd'),
    amount: Number(row.amount),
  }));
};

describe('Loan Balances history rebuild', () => {
  it('rebuilds a stepwise declining history: anchor row plus one cumulative row per payment day', async () => {
    const { loan, sourceAccount } = await setupLoanWithSource({
      initialBalance: 10_000,
    });

    // Anchor the 10000 outstanding 30 days in the past, then record payments
    // 20 and 10 days ago. The history must show the decline at those dates —
    // not a single row stamped today.
    await reAnchorLoan({ loanId: loan.id, balance: 10_000, asOf: DAY_30_AGO });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 2_000,
      time: subDays(new Date(), 20).toISOString(),
    });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 1_000,
      time: subDays(new Date(), 10).toISOString(),
    });

    const history = await getLoanHistory({ loanId: loan.id });

    // Exactly three rows: the re-anchor rebuild also removes the account-creation
    // row stamped today, since history from the anchor forward is fully
    // determined by the anchor snapshot plus the payment legs.
    expect(history).toEqual([
      { date: DAY_30_AGO, amount: -10_000 },
      { date: DAY_20_AGO, amount: -8_000 },
      { date: DAY_10_AGO, amount: -7_000 },
    ]);

    const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(reloaded.currentBalance).toBe(-7_000);
  });

  it('reshapes history when a payment amount is edited', async () => {
    const { loan, sourceAccount } = await setupLoanWithSource({
      initialBalance: 10_000,
    });
    await reAnchorLoan({ loanId: loan.id, balance: 10_000, asOf: DAY_30_AGO });
    const payment = await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 2_000,
      time: subDays(new Date(), 20).toISOString(),
    });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 1_000,
      time: subDays(new Date(), 10).toISOString(),
    });

    // Bump the 20-days-ago payment from 2000 to 3000 — the whole curve from
    // that day forward must shift down by the extra 1000. Both legs share the
    // loan's currency, so the edit sends `amount` (expense leg) together with
    // `destinationAmount` (loan leg), the way a client edits a same-currency
    // payment: the loan leg's refAmount is derived from the base leg's
    // (calcTransferTransactionRefAmount), so an amount left stale on the base
    // leg would leak the old value into the refAmount-based history rebuild.
    const editResponse = await helpers.updateTransaction({
      id: payment.id,
      payload: { amount: 3_000, destinationAmount: 3_000 },
      raw: false,
    });
    expect(editResponse.statusCode).toBe(200);

    const history = await getLoanHistory({ loanId: loan.id });
    expect(history).toEqual([
      { date: DAY_30_AGO, amount: -10_000 },
      { date: DAY_20_AGO, amount: -7_000 },
      { date: DAY_10_AGO, amount: -6_000 },
    ]);

    const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(reloaded.currentBalance).toBe(-6_000);
  });

  it('removes a deleted payment day from history without leaving a ghost row', async () => {
    const { loan, sourceAccount } = await setupLoanWithSource({
      initialBalance: 10_000,
    });
    await reAnchorLoan({ loanId: loan.id, balance: 10_000, asOf: DAY_30_AGO });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 2_000,
      time: subDays(new Date(), 20).toISOString(),
    });
    const laterPayment = await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 1_000,
      time: subDays(new Date(), 10).toISOString(),
    });

    await helpers.deleteTransaction({ id: laterPayment.id });

    const history = await getLoanHistory({ loanId: loan.id });
    expect(history).toEqual([
      { date: DAY_30_AGO, amount: -10_000 },
      { date: DAY_20_AGO, amount: -8_000 },
    ]);

    const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(reloaded.currentBalance).toBe(-8_000);
  });

  it('collapses multiple same-day payments into a single cumulative end-of-day row', async () => {
    // No re-anchor: the loan keeps its creation-day anchor, so the anchor day,
    // the account-creation Balances row, and both payments all share today.
    const { loan, sourceAccount } = await setupLoanWithSource({
      initialBalance: 10_000,
    });

    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 500,
    });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 300,
    });

    const history = await getLoanHistory({ loanId: loan.id });
    expect(history).toEqual([{ date: TODAY, amount: -9_200 }]);
  });

  it('keeps a foreign-currency loan on its own event-shaped history while the FX source account is revalued', async () => {
    // USD under the AED test base: both accounts are foreign-currency, but only the
    // non-loan one becomes a per-day revaluation grid. The loan owns its own rows.
    const { account: sourceAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: 'USD',
        initialBalance: 10_000,
        originalPrincipal: 10_000,
      }),
      raw: true,
    });

    await reAnchorLoan({ loanId: loan.id, balance: 10_000, asOf: DAY_30_AGO });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 2_000,
      time: subDays(new Date(), 20).toISOString(),
    });

    const loanHistory = await getLoanHistory({ loanId: loan.id });
    expect(loanHistory.map((row) => row.date)).toEqual([DAY_30_AGO, DAY_20_AGO]);

    const sourceHistory = await helpers.getBalanceHistory({
      accountId: sourceAccount.id,
      raw: true,
    });
    expect(sourceHistory.length).toBeGreaterThan(loanHistory.length);
  });
});

/** Runs `fn` authenticated as the user owning `cookies`, restoring the default test user afterwards. */
async function asUser<T>({ cookies, fn }: { cookies: string; fn: () => Promise<T> }): Promise<T> {
  const original = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = cookies;
  try {
    return await fn();
  } finally {
    global.APP_AUTH_COOKIES = original;
  }
}

async function createSecondUser(): Promise<string> {
  const signupRes = await helpers.makeAuthRequest({
    method: 'post',
    url: '/auth/sign-up/email',
    payload: {
      email: `user2-${Date.now()}-${Math.random()}@test.local`,
      password: 'testpassword123',
      name: 'Second User',
    },
  });
  const cookies = helpers.extractCookies(signupRes);
  await asUser({
    cookies,
    fn: () =>
      helpers.makeRequest({
        method: 'post',
        url: '/user/currencies/base',
        payload: { currencyCode: global.BASE_CURRENCY.code },
      }),
  });
  return cookies;
}

/**
 * USD loan under the AED test base currency, so base-currency (ref) figures
 * diverge from nominal ones and the endpoint's loan-currency output is
 * distinguishable from the Balances-table history. The source cash account
 * shares the loan's currency so payment legs carry the nominal USD amount.
 */
const setupNonBaseLoanWithSource = async ({ initialBalance }: { initialBalance: number }) => {
  const { account: sourceAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      currencyCode: 'USD',
      initialBalance,
      originalPrincipal: initialBalance,
    }),
    raw: true,
  });
  return { loan, sourceAccount };
};

describe('GET /loans/:id/balance-history (loan-currency series)', () => {
  it('returns nominal loan-currency amounts for a non-base-currency loan', async () => {
    const { loan, sourceAccount } = await setupNonBaseLoanWithSource({
      initialBalance: 10_000,
    });

    await reAnchorLoan({ loanId: loan.id, balance: 10_000, asOf: DAY_30_AGO });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 2_000,
      time: subDays(new Date(), 20).toISOString(),
    });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 1_000,
      time: subDays(new Date(), 10).toISOString(),
    });

    const history = await helpers.getLoanBalanceHistory({
      id: loan.id,
      raw: true,
    });

    // Nominal USD figures: opening tracked balance minus each nominal payment.
    expect(history).toEqual([
      { date: DAY_30_AGO, amount: -10_000 },
      { date: DAY_20_AGO, amount: -8_000 },
      { date: DAY_10_AGO, amount: -7_000 },
    ]);

    // The Balances-table history stores base-currency (AED) figures — the two
    // series must diverge, proving the endpoint doesn't echo ref conversions.
    const refHistory = await getLoanHistory({ loanId: loan.id });
    expect(refHistory[0]!.amount).not.toBe(-10_000);
  });

  it('returns a single opening point with no payments, then folds same-day payments into that anchor row', async () => {
    // No re-anchor: the creation-day anchor and both payments share today, so
    // the series stays a single point that already reflects the payments.
    const { loan, sourceAccount } = await setupNonBaseLoanWithSource({
      initialBalance: 10_000,
    });

    // Anchor defaults to the creation date, so the opening tracked balance is
    // the only point.
    expect(await helpers.getLoanBalanceHistory({ id: loan.id, raw: true })).toEqual([{ date: TODAY, amount: -10_000 }]);

    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 500,
    });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 300,
    });

    const history = await helpers.getLoanBalanceHistory({
      id: loan.id,
      raw: true,
    });
    expect(history).toEqual([{ date: TODAY, amount: -9_200 }]);
  });

  it("returns 404 for an unknown id and for another user's loan", async () => {
    const { loan } = await setupNonBaseLoanWithSource({
      initialBalance: 10_000,
    });

    const unknownResponse = await helpers.getLoanBalanceHistory({
      id: generateRandomRecordId(),
    });
    expect(unknownResponse.statusCode).toBe(404);

    const secondUserCookies = await createSecondUser();
    const foreignResponse = await asUser({
      cookies: secondUserCookies,
      fn: () => helpers.getLoanBalanceHistory({ id: loan.id }),
    });
    expect(foreignResponse.statusCode).toBe(404);
  });
});

// Card vs chart measure ref outstanding differently: refCurrentBalance is spot
// (native outstanding at the latest rate), while the Balances history accumulates
// each payment leg's historical-rate refAmount and loans skip the today-row spot
// pin. Diverging rates can leave the chart an FX residue after native settlement.

// Distinct calendar days: anchor well before both payments, payments on days
// with different seeded USD→AED rates so the leg refAmounts diverge.
const dayObj = (n: number) => subDays(startOfDay(new Date()), n);
const ANCHOR_DATE = dayObj(40);
const PAY_1_DATE = dayObj(25);
const PAY_2_DATE = dayObj(15);
const ANCHOR_KEY = format(ANCHOR_DATE, 'yyyy-MM-dd');
const PAY_2_KEY = format(PAY_2_DATE, 'yyyy-MM-dd');

// Rate on each payment day. Payment 1 lands high, payment 2 lands low; averaged
// against the anchor rate (today's spot, which stamps the loan's
// refInitialBalance on re-anchor) they can't net back to zero in the base
// currency even though the native amounts do.
const PAY_1_USD_TO_AED = 5.0;
const PAY_2_USD_TO_AED = 2.0;

/** Seeds an exact USD→AED rate for a historical day so a backdated payment's refAmount uses it. */
const seedUsdAedRate = async ({ date, rate }: { date: Date; rate: number }) => {
  await connection.sequelize.query(
    `DELETE FROM "ExchangeRates" WHERE "baseCode" = 'USD' AND "quoteCode" = 'AED' AND date = :date`,
    { replacements: { date } },
  );
  await connection.sequelize.query(
    `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
     VALUES ('USD', 'AED', :date, :rate, 'api-layer')`,
    { replacements: { date, rate } },
  );
};

describe('Cross-currency loan settlement: chart matches the card', () => {
  afterEach(async () => {
    // ExchangeRates is a seed table (not truncated between tests) and the global
    // beforeEach only clears today+future rows — drop this file's historical
    // fixtures so they can't leak into other tests on the same worker.
    await connection.sequelize.query(
      `DELETE FROM "ExchangeRates" WHERE "baseCode" = 'USD' AND "quoteCode" = 'AED' AND date IN (:pay1, :pay2)`,
      { replacements: { pay1: PAY_1_DATE, pay2: PAY_2_DATE } },
    );
  });

  it("settles the loan's net-worth chart to zero when the native outstanding reaches zero across diverging FX rates", async () => {
    // USD source cash account under the AED test base currency (also registers USD
    // as a user currency so the USD loan can be created).
    const { account: sourceAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });

    // USD loan owing $1200. Both `initialBalance` and `originalPrincipal` are the
    // full outstanding so paying it down twice by $600 settles it exactly.
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: 'USD',
        initialBalance: 1_200,
        originalPrincipal: 1_200,
      }),
      raw: true,
    });

    await seedUsdAedRate({ date: PAY_1_DATE, rate: PAY_1_USD_TO_AED });
    await seedUsdAedRate({ date: PAY_2_DATE, rate: PAY_2_USD_TO_AED });

    // Move the anchor 40 days back with the full $1200 still owed, so both later
    // payments count as post-anchor and land on days with distinct FX rates.
    await reAnchorLoan({ loanId: loan.id, balance: 1_200, asOf: ANCHOR_KEY });

    // $600 at USD→AED = 5.0 → leg refAmount = 3000 AED.
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 600,
      time: PAY_1_DATE.toISOString(),
    });
    // $600 at USD→AED = 2.0 → leg refAmount = 1200 AED. Native now fully settled.
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: 600,
      time: PAY_2_DATE.toISOString(),
    });

    const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });

    // Native outstanding is exactly zero: -1200 + 600 + 600 = 0.
    expect(reloaded.currentBalance).toBe(0);
    // Spot measure of a zero native outstanding: exactly zero.
    expect(reloaded.refCurrentBalance).toBe(0);

    const refHistory = await getLoanHistory({ loanId: loan.id });

    // The chart must read zero in the base currency at the settlement-dated row:
    // $0 owed is 0 owed regardless of currency. The accumulator instead carries
    // an FX residue — refInitialBalance (opening stamped at today's spot rate)
    // plus the two historical-rate legs (3000 + 1200 AED) don't net to zero.
    const settlementRow = refHistory.find((row) => row.date === PAY_2_KEY);
    expect(settlementRow).toBeDefined();
    expect(settlementRow!.amount).toBe(0);

    // …and at the latest/current point, which must equal the account card's spot
    // refCurrentBalance (also zero) for a settled loan.
    const latestRow = refHistory[refHistory.length - 1];
    expect(latestRow!.date).toBe(PAY_2_KEY);
    expect(latestRow!.amount).toBe(0);
    expect(latestRow!.amount).toBe(reloaded.refCurrentBalance);
  });
});

describe('Loan history at the loan currency decimals', () => {
  /**
   * A `currencyCode` loan owing 1000.125-style `owed`, re-anchored 30 days back and paid `payment`
   * 20 days back from a same-currency account. Returns both the loan-currency series and the
   * base-currency Balances rows.
   */
  const anchoredAndPaid = async ({
    currencyCode,
    owed,
    payment,
  }: {
    currencyCode: string;
    owed: number;
    payment: number;
  }) => {
    await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });
    const category = await helpers.addCustomCategory({ name: 'Loan payment', color: '#123456', raw: true });
    const sourceAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode }),
      raw: true,
    });
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({ currencyCode, initialBalance: owed, originalPrincipal: owed }),
      raw: true,
    });
    await reAnchorLoan({ loanId: loan.id, balance: owed, asOf: DAY_30_AGO });
    await payLoan({
      loanId: loan.id,
      sourceAccountId: sourceAccount.id as RecordId,
      amount: payment,
      time: subDays(new Date(), 20).toISOString(),
      categoryId: category.id,
    });

    return {
      series: await helpers.getLoanBalanceHistory({ id: loan.id, raw: true }),
      balances: await getLoanHistory({ loanId: loan.id }),
    };
  };

  it('keeps 3 decimals in the KWD loan-currency series and rounds the base rows to 2 in a 2-decimal book', async () => {
    const { series, balances } = await anchoredAndPaid({ currencyCode: 'KWD', owed: 1000.125, payment: 10.125 });

    expect(series).toEqual([
      { date: DAY_30_AGO, amount: -1000.125 },
      { date: DAY_20_AGO, amount: -990 },
    ]);
    expect(balances).toHaveLength(2);
    for (const row of balances) {
      expect(row.amount).toBe(Number(row.amount.toFixed(2)));
    }
  });

  it('keeps 3 decimals in the base-currency rows of a KWD-base book', async () => {
    const user = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'KWD' });
    const { series, balances } = await helpers.asUser({
      cookies: user.cookies,
      fn: () => anchoredAndPaid({ currencyCode: 'KWD', owed: 1000.125, payment: 10.125 }),
    });

    expect(series).toEqual([
      { date: DAY_30_AGO, amount: -1000.125 },
      { date: DAY_20_AGO, amount: -990 },
    ]);
    expect(balances).toEqual([
      { date: DAY_30_AGO, amount: -1000.125 },
      { date: DAY_20_AGO, amount: -990 },
    ]);
  });

  it('keeps the 2-decimal series and rows of a primary-currency loan', async () => {
    const { series, balances } = await anchoredAndPaid({
      currencyCode: global.BASE_CURRENCY_CODE,
      owed: 1000.12,
      payment: 10.12,
    });

    expect(series).toEqual([
      { date: DAY_30_AGO, amount: -1000.12 },
      { date: DAY_20_AGO, amount: -990 },
    ]);
    expect(balances).toEqual(series.map((point) => ({ date: point.date, amount: point.amount })));
  });
});
