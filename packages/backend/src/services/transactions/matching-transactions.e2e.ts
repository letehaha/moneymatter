import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays, subDays } from 'date-fns';

const createTx = async ({
  accountId,
  amount,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  accountId: RecordId;
  amount: number;
  transactionType?: TRANSACTION_TYPES;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, transactionType }),
    raw: true,
  });
  return tx;
};

describe('GET /transactions/summary', () => {
  it('returns zeros when nothing matches', async () => {
    const account = await helpers.createAccount({ raw: true });

    const summary = await helpers.getTransactionsSummary({ accountIds: [account.id], raw: true });

    expect(summary).toEqual({ count: 0, income: 0, expense: 0, net: 0, transfers: 0 });
  });

  it('totals income and expense, and reports a two-leg transfer once and apart from them', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    await createTx({ accountId: accountA.id, amount: 300, transactionType: TRANSACTION_TYPES.income });
    await createTx({ accountId: accountA.id, amount: 120 });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 50 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 500 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 500,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });

    const both = await helpers.getTransactionsSummary({ accountIds: [accountA.id, accountB.id], raw: true });
    expect(both).toEqual({ count: 4, income: 300, expense: 170, net: 130, transfers: 500 });

    // Only the income leg matches, so it is the row the list shows.
    const destinationOnly = await helpers.getTransactionsSummary({ accountIds: [accountB.id], raw: true });
    expect(destinationOnly).toEqual({ count: 1, income: 0, expense: 0, net: 0, transfers: 500 });
  });

  it('counts a transaction once when it carries several of the filtered tags', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tagA = await helpers.createTag({ payload: { name: 'A', color: '#ff0000' }, raw: true });
    const tagB = await helpers.createTag({ payload: { name: 'B', color: '#00ff00' }, raw: true });
    const both = await createTx({ accountId: account.id, amount: 40 });
    const onlyA = await createTx({ accountId: account.id, amount: 10 });
    await createTx({ accountId: account.id, amount: 999 });
    await helpers.addTransactionsToTag({ tagId: tagA.id, transactionIds: [both.id, onlyA.id], raw: true });
    await helpers.addTransactionsToTag({ tagId: tagB.id, transactionIds: [both.id], raw: true });

    const summary = await helpers.getTransactionsSummary({ tagIds: [tagA.id, tagB.id], raw: true });

    expect(summary).toEqual({ count: 2, income: 0, expense: 50, net: -50, transfers: 0 });
  });

  it('sums foreign-currency rows in the base currency', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
    const usdExpense = await createTx({ accountId: account.id, amount: 100 });
    const { refAmount } = (await helpers.getTransactionById({ id: usdExpense.id, raw: true }))!;
    expect(refAmount).not.toBe(100);

    const summary = await helpers.getTransactionsSummary({ accountIds: [account.id], raw: true });

    expect(summary.expense).toBe(refAmount);
  });

  it('leaves planned rows out when isPlanned is false', async () => {
    const account = await helpers.createAccount({ raw: true });
    await createTx({ accountId: account.id, amount: 20 });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 70,
        transactionType: TRANSACTION_TYPES.expense,
        time: addDays(new Date(), 3).toISOString(),
      },
      raw: true,
    });

    const withPlans = await helpers.getTransactionsSummary({ accountIds: [account.id], raw: true });
    const withoutPlans = await helpers.getTransactionsSummary({
      accountIds: [account.id],
      isPlanned: false,
      raw: true,
    });

    expect(withPlans).toMatchObject({ count: 2, expense: 90 });
    expect(withoutPlans).toMatchObject({ count: 1, expense: 20 });
  });

  it('rejects an inverted amount range', async () => {
    const response = await helpers.getTransactionsSummary({ amountGte: 100, amountLte: 10 });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});

describe('bulk actions targeting everything that matches the list filters', () => {
  it('PUT /transactions/bulk updates every match except the excluded ids', async () => {
    const account = await helpers.createAccount({ raw: true });
    const other = await helpers.createAccount({ raw: true });
    const first = await createTx({ accountId: account.id, amount: 10 });
    const second = await createTx({ accountId: account.id, amount: 20 });
    const excluded = await createTx({ accountId: account.id, amount: 30 });
    const outside = await createTx({ accountId: other.id, amount: 40 });

    const result = await helpers.bulkUpdateTransactions({
      payload: {
        selection: { filters: { accountIds: [account.id] }, excludedIds: [excluded.id] },
        note: 'bulk',
      },
      raw: true,
    });

    expect(result.updatedIds.toSorted()).toEqual([first.id, second.id].toSorted());

    const rows = await helpers.getTransactions({ raw: true });
    const noteById = new Map(rows.map((tx) => [tx.id, tx.note]));
    expect(noteById.get(first.id)).toBe('bulk');
    expect(noteById.get(second.id)).toBe('bulk');
    expect(noteById.get(excluded.id)).not.toBe('bulk');
    expect(noteById.get(outside.id)).not.toBe('bulk');
  });

  it('POST /transactions/bulk-delete deletes every match except the excluded ids', async () => {
    const account = await helpers.createAccount({ raw: true });
    const other = await helpers.createAccount({ raw: true });
    const first = await createTx({ accountId: account.id, amount: 10 });
    const excluded = await createTx({ accountId: account.id, amount: 30 });
    const outside = await createTx({ accountId: other.id, amount: 40 });

    const result = await helpers.bulkDeleteTransactions({
      payload: { selection: { filters: { accountIds: [account.id] }, excludedIds: [excluded.id] } },
      raw: true,
    });

    expect(result.deletedIds).toEqual([first.id]);

    const remainingIds = (await helpers.getTransactions({ raw: true })).map((tx) => tx.id);
    expect(remainingIds).toEqual(expect.arrayContaining([excluded.id, outside.id]));
    expect(remainingIds).not.toContain(first.id);
  });

  it('honours date filters, so rows outside the range survive', async () => {
    const account = await helpers.createAccount({ raw: true });
    const recent = await createTx({ accountId: account.id, amount: 10 });
    const [old] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        time: subDays(new Date(), 30).toISOString(),
      }),
      raw: true,
    });

    const result = await helpers.bulkDeleteTransactions({
      payload: {
        selection: {
          filters: { accountIds: [account.id], from: subDays(new Date(), 5).toISOString() },
        },
      },
      raw: true,
    });

    expect(result.deletedIds).toEqual([recent.id]);
    const remainingIds = (await helpers.getTransactions({ raw: true })).map((tx) => tx.id);
    expect(remainingIds).toContain(old.id);
  });

  it('keeps a whole transfer when either of its legs is excluded', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const [expenseLeg, incomeLeg] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 500 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 500,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });
    const plain = await createTx({ accountId: accountA.id, amount: 10 });

    const result = await helpers.bulkDeleteTransactions({
      payload: {
        selection: { filters: { accountIds: [accountA.id, accountB.id] }, excludedIds: [incomeLeg!.id] },
      },
      raw: true,
    });

    expect(result.deletedIds).toEqual([plain.id]);
    const remainingIds = (await helpers.getTransactions({ raw: true })).map((tx) => tx.id);
    expect(remainingIds).toEqual(expect.arrayContaining([expenseLeg.id, incomeLeg!.id]));
  });

  it('rejects an unknown filter key instead of widening the target', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tx = await createTx({ accountId: account.id, amount: 10 });

    const response = await helpers.bulkDeleteTransactions({
      payload: { selection: { filters: { acountIds: [account.id] } } },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    const remainingIds = (await helpers.getTransactions({ raw: true })).map((row) => row.id);
    expect(remainingIds).toContain(tx.id);
  });

  it('rejects a body with both targets, and one with neither', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tx = await createTx({ accountId: account.id, amount: 10 });

    const both = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [tx.id], selection: { filters: {} } } as never,
    });
    expect(both.statusCode).toBe(ERROR_CODES.ValidationError);

    const neither = await helpers.bulkUpdateTransactions({ payload: { note: 'x' } as never });
    expect(neither.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('returns 404 when the filters match nothing', async () => {
    const account = await helpers.createAccount({ raw: true });

    const response = await helpers.bulkDeleteTransactions({
      payload: { selection: { filters: { accountIds: [account.id] } } },
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
