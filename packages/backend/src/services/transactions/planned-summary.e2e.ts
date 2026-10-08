import {
  ACCOUNT_STATUSES,
  type GetPlannedSummaryResponse,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays } from 'date-fns';

const getPlannedSummary = <R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) =>
  helpers.makeRequest<GetPlannedSummaryResponse, R>({
    method: 'get',
    url: '/transactions/planned-summary',
    raw,
  });

const createOwnedAccount = () => helpers.createAccount({ raw: true });

describe('GET /transactions/planned-summary', () => {
  it('aggregates pending plans per account', async () => {
    const baseAccount = await createOwnedAccount();
    const { account: usdAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });

    const incomeTime = addDays(new Date(), 3);
    const expenseTime = addDays(new Date(), 12);
    const usdTime = addDays(new Date(), 6);

    await helpers.createPlannedTransaction({
      payload: {
        accountId: baseAccount.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.income,
        time: incomeTime.toISOString(),
      },
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: baseAccount.id,
        amount: 120,
        transactionType: TRANSACTION_TYPES.expense,
        time: expenseTime.toISOString(),
      },
      raw: true,
    });
    const [usdExpense] = await helpers.createPlannedTransaction({
      payload: {
        accountId: usdAccount.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
        time: usdTime.toISOString(),
      },
      raw: true,
    });
    const usdExpenseApi = await helpers.getTransactionById({ id: usdExpense.id, raw: true });

    const summary = await getPlannedSummary({ raw: true });
    const byAccountId = new Map(summary.map((row) => [row.accountId, row]));

    expect(summary).toHaveLength(2);

    const baseRow = byAccountId.get(baseAccount.id)!;
    expect(baseRow.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(baseRow.plannedDelta).toBe(180);
    expect(baseRow.refPlannedDelta).toBe(180);
    expect(baseRow.count).toBe(2);
    expect(baseRow.latestTime).toBe(expenseTime.toISOString());

    const usdRow = byAccountId.get(usdAccount.id)!;
    expect(usdRow.currencyCode).toBe('USD');
    expect(usdRow.plannedDelta).toBe(-50);
    expect(usdRow.refPlannedDelta).toBe(-usdExpenseApi!.refAmount);
    expect(usdRow.refPlannedDelta).not.toBe(usdRow.plannedDelta);
    expect(usdRow.count).toBe(1);
    expect(usdRow.latestTime).toBe(usdTime.toISOString());
  });

  it('returns an empty array when the caller has no planned rows', async () => {
    const account = await createOwnedAccount();
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });

    expect(await getPlannedSummary({ raw: true })).toEqual([]);
  });

  it('never exposes another user planned rows', async () => {
    const account = await createOwnedAccount();
    await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 250, time: addDays(new Date(), 5).toISOString() },
      raw: true,
    });

    const stranger = await helpers.provisionSecondUserWithBaseCurrency();
    const summary = await helpers.asUser({
      cookies: stranger.cookies,
      fn: () => getPlannedSummary({ raw: true }),
    });

    expect(summary).toEqual([]);
  });

  it('contributes nothing for an account shared with the caller', async () => {
    const account = await createOwnedAccount();
    await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 250, time: addDays(new Date(), 5).toISOString() },
      raw: true,
    });

    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    const summary = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        const acceptResponse = await helpers.acceptShareInvitation({ token: invitation.token });
        expect(acceptResponse.statusCode).toBe(200);
        return getPlannedSummary({ raw: true });
      },
    });

    expect(summary).toEqual([]);
  });

  it('still returns a row for an archived account', async () => {
    const account = await createOwnedAccount();
    const time = addDays(new Date(), 4);
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 75,
        transactionType: TRANSACTION_TYPES.expense,
        time: time.toISOString(),
      },
      raw: true,
    });

    const archiveResponse = await helpers.updateAccount({
      id: account.id,
      payload: { status: ACCOUNT_STATUSES.archived },
    });
    expect(archiveResponse.statusCode).toBe(200);

    const summary = await getPlannedSummary({ raw: true });

    expect(summary).toHaveLength(1);
    expect(summary[0]).toEqual(
      expect.objectContaining({
        accountId: account.id,
        plannedDelta: -75,
        refPlannedDelta: -75,
        count: 1,
        latestTime: time.toISOString(),
      }),
    );
  });
});

describe('GET /transactions isPlanned filter', () => {
  it('splits planned from real rows and returns both when the filter is absent', async () => {
    const account = await createOwnedAccount();
    const [real] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });
    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 250, time: addDays(new Date(), 5).toISOString() },
      raw: true,
    });

    const plannedOnly = await helpers.getTransactions({ isPlanned: true, raw: true });
    expect(plannedOnly.map((tx) => tx.id)).toEqual([planned.id]);

    const realOnly = await helpers.getTransactions({ isPlanned: false, raw: true });
    expect(realOnly.map((tx) => tx.id)).toEqual([real.id]);

    const unfiltered = await helpers.getTransactions({ raw: true });
    expect(unfiltered.map((tx) => tx.id).toSorted()).toEqual([real.id, planned.id].toSorted());
  });
});
