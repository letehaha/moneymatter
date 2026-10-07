import { CATEGORY_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { format } from 'date-fns';

/** Runs `fn` with a different user's session cookies, restoring the original afterwards. */
async function asUser<T>({ cookies, fn }: { cookies: string; fn: () => Promise<T> }): Promise<T> {
  const original = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = cookies;
  try {
    return await fn();
  } finally {
    global.APP_AUTH_COOKIES = original;
  }
}

/** Registers a fresh user (with the shared base currency) and returns their session cookies. */
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

/** Reads the error envelope (`code` + `message`) from a failed helper response. */
const extractError = (response: unknown) =>
  (response as helpers.CustomResponse<unknown>).body.response as unknown as {
    code: string;
    message: string;
  };

describe('Balance Adjustment', () => {
  it('creates income transaction when target > current balance', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
      raw: true,
    });

    const note = 'Reconciliation with bank statement';
    const result = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(1500), note },
      raw: true,
    });

    expect(result.previousBalance).toBe(1000);
    expect(result.newBalance).toBe(1500);
    expect(result.transaction).not.toBeNull();
    expect(result.transaction!.transactionType).toBe(TRANSACTION_TYPES.income);
    expect(result.transaction!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
    expect(result.transaction!.amount).toBe(500);
    expect(result.transaction!.note).toBe(note);

    const categories = await helpers.getCategoriesList();
    const otherCategory = categories.find((c) => c.type === CATEGORY_TYPES.internal);
    expect(otherCategory).toBeDefined();
    expect(result.transaction!.categoryId).toBe(otherCategory!.id);

    const storedTx = await Transactions.findOne({ where: { id: result.transaction!.id } });
    expect(storedTx!.externalData).toEqual({ balanceAdjustment: true });

    const updatedAccount = await helpers.getAccount({ id: account.id, raw: true });
    expect(updatedAccount.currentBalance).toBe(1500);
  });

  it('creates expense transaction when target < current balance', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 2000 }),
      raw: true,
    });

    const result = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(800) },
      raw: true,
    });

    expect(result.previousBalance).toBe(2000);
    expect(result.newBalance).toBe(800);
    expect(result.transaction).not.toBeNull();
    expect(result.transaction!.transactionType).toBe(TRANSACTION_TYPES.expense);
    expect(result.transaction!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
    expect(result.transaction!.amount).toBe(1200);

    const storedTx = await Transactions.findOne({ where: { id: result.transaction!.id } });
    expect(storedTx!.externalData).toEqual({ balanceAdjustment: true });

    const updatedAccount = await helpers.getAccount({ id: account.id, raw: true });
    expect(updatedAccount.currentBalance).toBe(800);

    // Stats endpoints take date-only `YYYY-MM-DD` bounds.
    const today = new Date();
    const from = format(new Date(today.getFullYear(), today.getMonth(), 1), 'yyyy-MM-dd');
    const to = format(new Date(today.getFullYear(), today.getMonth() + 1, 0), 'yyyy-MM-dd');

    // The out_of_wallet adjustment must NOT appear in expense stats
    const expenses = await helpers.getExpensesAmountForPeriod({ from, to, raw: true });
    expect(expenses).toBe(0);
  });

  it('returns no transaction when target equals current balance', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 500 }),
      raw: true,
    });

    const result = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(500) },
      raw: true,
    });

    expect(result.previousBalance).toBe(500);
    expect(result.newBalance).toBe(500);
    expect(result.transaction).toBeNull();

    const updatedAccount = await helpers.getAccount({ id: account.id, raw: true });
    expect(updatedAccount.currentBalance).toBe(500);
  });

  it('rejects an adjustment on a bank-linked account and creates no transaction', async () => {
    const { account } = await helpers.lunchflow.mockTransactions();
    const before = await helpers.getAccount({ id: account.id, raw: true });
    const rowsBefore = (await helpers.getTransactions({ accountIds: [account.id], raw: true })).length;

    const res = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(Number(before.currentBalance) + 50) },
    });

    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toHaveLength(rowsBefore);
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(before.currentBalance);
  });

  it('returns 404 when account does not belong to user', async () => {
    const res = await helpers.balanceAdjustment({
      id: generateRandomRecordId(),
      payload: { targetBalance: asDecimal(100) },
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('handles non-default currency correctly', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });

    const result = await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(5000) },
      raw: true,
    });

    expect(result.transaction).not.toBeNull();
    expect(result.newBalance).toBe(5000);

    const updatedAccount = await helpers.getAccount({ id: account.id, raw: true });
    expect(updatedAccount.currentBalance).toBe(5000);
  });

  describe('owner-scoping of account write paths', () => {
    it("rejects a balance adjustment on another user's account and leaves it untouched", async () => {
      // User B owns the account.
      const userBCookies = await createSecondUser();
      const userBAccount = await asUser({
        cookies: userBCookies,
        fn: () =>
          helpers.createAccount({
            payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
            raw: true,
          }),
      });

      // User A (default suite session) tries to adjust User B's real account by id.
      // A random-UUID 404 can't catch a dropped `userId` scope in `getAccountById`;
      // this hits a real row owned by someone else, so it only 404s if scoping holds.
      const res = await helpers.balanceAdjustment({
        id: userBAccount.id,
        payload: { targetBalance: asDecimal(9999) },
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);

      // User B's account must be unchanged.
      const afterAccount = await asUser({
        cookies: userBCookies,
        fn: () => helpers.getAccount({ id: userBAccount.id, raw: true }),
      });
      expect(afterAccount.currentBalance).toBe(1000);
    });

    it("rejects linking another user's account to a bank connection with a not-found account error", async () => {
      const userBCookies = await createSecondUser();
      const userBAccount = await asUser({
        cookies: userBCookies,
        fn: () =>
          helpers.createAccount({
            payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
            raw: true,
          }),
      });

      // The account is fetched (owner-scoped) before the connection is validated, so
      // a dropped `userId` scope would surface User B's account and fail later with a
      // *connection* error instead of this *account* not-found. Assert the account error.
      const res = await helpers.linkAccountToBankConnection({
        id: userBAccount.id,
        connectionId: generateRandomRecordId(),
        externalAccountId: generateRandomRecordId(),
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(extractError(res).message).toContain(userBAccount.id);
    });

    it("rejects unlinking another user's account with a not-found account error", async () => {
      const userBCookies = await createSecondUser();
      const userBAccount = await asUser({
        cookies: userBCookies,
        fn: () =>
          helpers.createAccount({
            payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
            raw: true,
          }),
      });

      // Account fetch is owner-scoped and runs first. A dropped `userId` scope would
      // find User B's (unlinked, system) account and fail with a *validation* error
      // ("not linked to any bank connection") instead of this account not-found.
      const res = await helpers.unlinkAccountFromBankConnection({
        id: userBAccount.id,
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(extractError(res).message).toContain(userBAccount.id);
    });
  });
});
