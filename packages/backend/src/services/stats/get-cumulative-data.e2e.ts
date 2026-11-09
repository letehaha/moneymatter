import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

// Fixed windows in the past: the report stops iterating at the current month, so a window that
// reaches into the future would report fewer months than it was asked for.
const JAN = { from: '2026-01-01', to: '2026-01-31' };

const periodValues = (result: { currentPeriod: { data: { periodValue: number }[] } }) =>
  result.currentPeriod.data.map((month) => month.periodValue);

describe('GET /stats/cumulative', () => {
  it('excludes planned rows from both the expense and the income cumulative totals', async () => {
    const account = await helpers.createAccount({ raw: true });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-10T12:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 120,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-20T12:00:00.000Z',
      },
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-01-05T12:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-01-25T12:00:00.000Z',
      },
      raw: true,
    });

    const expenses = await helpers.getCumulativeData({ ...JAN, metric: 'expenses', raw: true });
    const income = await helpers.getCumulativeData({ ...JAN, metric: 'income', raw: true });

    expect(expenses.currentPeriod.total).toBe(300);
    expect(expenses.currentPeriod.data[0]!.periodValue).toBe(300);
    expect(income.currentPeriod.total).toBe(500);
    expect(income.currentPeriod.data[0]!.periodValue).toBe(500);
  }, 60_000);

  it('nets a full refund out entirely and keeps a partial refund out of the income total', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [fullyRefundedExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-10T12:00:00.000Z',
      }),
      raw: true,
    });
    const [fullRefundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-01-20T12:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: fullyRefundedExpense.id, refundTxId: fullRefundTx.id });

    // Kept unrefunded so the expected total is a real number rather than a zero any broken
    // fixture would also produce.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-12T12:00:00.000Z',
      }),
      raw: true,
    });

    const [partiallyRefundedExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-14T12:00:00.000Z',
      }),
      raw: true,
    });
    const [partialRefundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 150,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-01-22T12:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: partiallyRefundedExpense.id, refundTxId: partialRefundTx.id });

    const expenses = await helpers.getCumulativeData({ ...JAN, metric: 'expenses', raw: true });
    const income = await helpers.getCumulativeData({ ...JAN, metric: 'income', raw: true });

    // 100 unrefunded + 250 residual of the partial refund: a leaking full refund reads 750,
    // a leaking partial refund reads 500. Neither refund is earnings.
    expect(expenses.currentPeriod.total).toBe(350);
    expect(expenses.currentPeriod.data[0]!.periodValue).toBe(350);
    expect(income.currentPeriod.total).toBe(0);
  }, 60_000);

  it('nets each side of a cross-month refund in its own transaction month', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: '2026-01-10T12:00:00.000Z',
      }),
      raw: true,
    });
    const [refundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-02-05T12:00:00.000Z',
      }),
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.income,
        time: '2026-02-15T12:00:00.000Z',
      }),
      raw: true,
    });

    const JAN_FEB = { from: '2026-01-01', to: '2026-02-28' };
    const FEB = { from: '2026-02-01', to: '2026-02-28' };
    const expenses = await helpers.getCumulativeData({ ...JAN_FEB, metric: 'expenses', raw: true });
    const income = await helpers.getCumulativeData({ ...JAN_FEB, metric: 'income', raw: true });
    const savings = await helpers.getCumulativeData({ ...JAN_FEB, metric: 'savings', raw: true });
    expect(periodValues(expenses)).toEqual([70, 0]);
    expect(periodValues(income)).toEqual([0, 500]);
    expect(periodValues(savings)).toEqual([-70, 500]);

    const januaryExpenses = await helpers.getCumulativeData({ ...JAN, metric: 'expenses', raw: true });
    expect(januaryExpenses.currentPeriod.total).toBe(70);

    const februaryExpenses = await helpers.getCumulativeData({ ...FEB, metric: 'expenses', raw: true });
    const februaryIncome = await helpers.getCumulativeData({ ...FEB, metric: 'income', raw: true });
    expect(februaryExpenses.currentPeriod.total).toBe(0);
    expect(februaryExpenses.previousPeriod.total).toBe(70);
    expect(februaryIncome.currentPeriod.total).toBe(500);
  }, 60_000);
});

const uniqueName = (prefix: string): string => `${prefix}-${generateRandomRecordId()}`;

const expenseAt = async ({
  accountId,
  amount,
  categoryId,
  payeeId,
  time = '2026-01-10T12:00:00.000Z',
}: {
  accountId: RecordId;
  amount: number;
  categoryId?: RecordId;
  payeeId?: RecordId;
  time?: string;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      time,
      ...(categoryId ? { categoryId } : {}),
      ...(payeeId ? { payeeId } : {}),
    }),
    raw: true,
  });
  return tx;
};

/** The cash leg of a loan payment counts as spend and carries no category. */
const uncategorizedExpense = async ({ accountId, amount }: { accountId: RecordId; amount: number }) => {
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({ initialBalance: 2_500, originalPrincipal: 2_500 }),
    raw: true,
  });

  await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId, amount, time: '2026-01-12T12:00:00.000Z' }),
      categoryId: undefined,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loan.id as RecordId,
    },
    raw: true,
  });
};

describe('GET /stats/cumulative – page-level scope filters', () => {
  it('categoryIds: selecting a parent pulls in transactions filed under its child', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parent = await helpers.addCustomCategory({ name: uniqueName('Parent'), color: '#112233', raw: true });
    const child = await helpers.addCustomCategory({ name: uniqueName('Child'), parentId: parent.id, raw: true });
    const unrelated = await helpers.addCustomCategory({ name: uniqueName('Unrelated'), color: '#445566', raw: true });

    await expenseAt({ accountId: account.id, amount: 200, categoryId: child.id });
    await expenseAt({ accountId: account.id, amount: 100, categoryId: unrelated.id });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      categoryIds: [parent.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(200);
  });

  it('excludedCategoryIds: an excluded parent drops its child while uncategorized spend stays', async () => {
    const account = await helpers.createAccount({ raw: true });
    const parent = await helpers.addCustomCategory({ name: uniqueName('Parent'), color: '#112233', raw: true });
    const child = await helpers.addCustomCategory({ name: uniqueName('Child'), parentId: parent.id, raw: true });
    const unrelated = await helpers.addCustomCategory({ name: uniqueName('Unrelated'), color: '#445566', raw: true });

    await expenseAt({ accountId: account.id, amount: 200, categoryId: child.id });
    await expenseAt({ accountId: account.id, amount: 100, categoryId: unrelated.id });
    await uncategorizedExpense({ accountId: account.id, amount: 50 });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      excludedCategoryIds: [parent.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(150);
  });

  it('accountIds narrows to the selected accounts and wins over accountId', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    await expenseAt({ accountId: accountA.id, amount: 60 });
    await expenseAt({ accountId: accountB.id, amount: 90 });

    const onlyA = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      accountId: accountB.id,
      accountIds: [accountA.id],
      raw: true,
    });
    expect(onlyA.currentPeriod.total).toBe(60);
  });

  it('payeeIds keeps only transactions linked to the selected payees', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payeeA = await helpers.createPayee({ payload: { name: uniqueName('Acme') }, raw: true });
    const payeeB = await helpers.createPayee({ payload: { name: uniqueName('Globex') }, raw: true });

    await expenseAt({ accountId: account.id, amount: 45, payeeId: payeeA.id });
    await expenseAt({ accountId: account.id, amount: 30, payeeId: payeeB.id });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      payeeIds: [payeeA.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(45);
  });

  it('tagIds counts a transaction carrying two selected tags exactly once', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tagA = await helpers.createTag({ payload: { name: uniqueName('TagA'), color: '#ff0000' }, raw: true });
    const tagB = await helpers.createTag({ payload: { name: uniqueName('TagB'), color: '#00ff00' }, raw: true });

    const doubleTagged = await expenseAt({ accountId: account.id, amount: 50 });
    await helpers.addTransactionsToTag({
      tagId: tagA.id,
      transactionIds: [doubleTagged.id],
    });
    await helpers.addTransactionsToTag({
      tagId: tagB.id,
      transactionIds: [doubleTagged.id],
    });

    await expenseAt({ accountId: account.id, amount: 20 });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      tagIds: [tagA.id, tagB.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(50);
  });

  it('excludedPayeeIds drops the excluded payee while a payee-less transaction stays', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payee = await helpers.createPayee({ payload: { name: uniqueName('Acme') }, raw: true });

    await expenseAt({ accountId: account.id, amount: 45, payeeId: payee.id });
    await expenseAt({ accountId: account.id, amount: 20 });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      excludedPayeeIds: [payee.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(20);
  });

  it('excludedTagIds drops a transaction carrying an excluded tag and keeps an untagged one', async () => {
    const account = await helpers.createAccount({ raw: true });
    const excludedTag = await helpers.createTag({
      payload: { name: uniqueName('Hidden'), color: '#ff0000' },
      raw: true,
    });
    const otherTag = await helpers.createTag({ payload: { name: uniqueName('Other'), color: '#00ff00' }, raw: true });

    const tagged = await expenseAt({ accountId: account.id, amount: 60 });
    await helpers.addTransactionsToTag({ tagId: excludedTag.id, transactionIds: [tagged.id] });
    await helpers.addTransactionsToTag({ tagId: otherTag.id, transactionIds: [tagged.id] });

    await expenseAt({ accountId: account.id, amount: 30 });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      excludedTagIds: [excludedTag.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(30);
  });

  it('applies the scope to the previous period as well as the current one', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tag = await helpers.createTag({ payload: { name: uniqueName('Scoped'), color: '#abcdef' }, raw: true });

    await expenseAt({ accountId: account.id, amount: 40 });
    const previous = await expenseAt({
      accountId: account.id,
      amount: 70,
      time: '2025-12-10T12:00:00.000Z',
    });
    await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [previous.id] });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      tagIds: [tag.id],
      raw: true,
    });

    expect(result.previousPeriod.total).toBe(70);
    expect(result.currentPeriod.total).toBe(0);
  });

  it('empty state: a tag with no transactions reports a zero cumulative total', async () => {
    const account = await helpers.createAccount({ raw: true });
    const unusedTag = await helpers.createTag({ payload: { name: uniqueName('Unused'), color: '#123456' }, raw: true });

    await expenseAt({ accountId: account.id, amount: 80 });

    const result = await helpers.getCumulativeData({
      ...JAN,
      metric: 'expenses',
      tagIds: [unusedTag.id],
      raw: true,
    });
    expect(result.currentPeriod.total).toBe(0);
    expect(result.currentPeriod.data.every((month) => month.periodValue === 0)).toBe(true);
  });
});
