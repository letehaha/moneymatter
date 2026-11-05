import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID, generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

/**
 * Tests for creating a transaction that refunds a specific split
 * using the refundForTxId and refundForSplitId parameters during creation.
 */
describe('Create transaction that refunds a specific split', () => {
  it('should create a refund transaction targeting a specific split', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const foodCategory = categories[0]!;
    const shoppingCategory = categories[1]!;

    // 1. Create expense with split: $100 total = $60 food (primary) + $40 shopping (split)
    const expensePayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: foodCategory.id,
      amount: 10000, // $100.00 in cents
      transactionType: TRANSACTION_TYPES.expense,
      splits: [{ categoryId: shoppingCategory.id, amount: 4000 }], // $40 to shopping
    });

    await helpers.createTransaction({
      payload: expensePayload,
      raw: false,
    });

    // Get the expense transaction with splits
    const expenseTransactions = await helpers.getTransactions({
      raw: true,
      includeSplits: true,
    });

    expect(expenseTransactions).toHaveLength(1);
    const expenseTx = expenseTransactions![0]!;
    expect(expenseTx.splits).toHaveLength(1);
    const shoppingSplit = expenseTx.splits![0]!;

    // 2. Create income transaction that refunds the shopping split
    // Using refundForTxId and refundForSplitId during creation
    const refundPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: shoppingCategory.id,
      amount: 4000, // $40.00 refund for the shopping split
      transactionType: TRANSACTION_TYPES.income, // Opposite type
      refundForTxId: expenseTx.id,
      refundForSplitId: shoppingSplit.id,
    });

    const [refundTx] = await helpers.createTransaction({
      payload: refundPayload,
      raw: true,
    });

    expect(refundTx).toBeDefined();

    // 3. Verify the refund link was created
    const refundLink = await helpers.getSingleRefund(
      {
        originalTxId: expenseTx.id,
        refundTxId: refundTx.id,
      },
      true,
    );

    expect(refundLink).toBeDefined();
    expect(refundLink.splitId).toBe(shoppingSplit.id);
  });

  it('should create partial refund for a split', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const foodCategory = categories[0]!;
    const shoppingCategory = categories[1]!;

    // Create expense with split: $100 total = $60 food + $40 shopping
    const expensePayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: foodCategory.id,
      amount: 10000,
      transactionType: TRANSACTION_TYPES.expense,
      splits: [{ categoryId: shoppingCategory.id, amount: 4000 }],
    });

    await helpers.createTransaction({ payload: expensePayload, raw: false });

    const expenseTransactions = await helpers.getTransactions({
      raw: true,
      includeSplits: true,
    });
    const expenseTx = expenseTransactions![0]!;
    const shoppingSplit = expenseTx.splits![0]!;

    // First partial refund: $20 of the $40 split
    const refund1Payload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: shoppingCategory.id,
      amount: 2000, // $20
      transactionType: TRANSACTION_TYPES.income,
      refundForTxId: expenseTx.id,
      refundForSplitId: shoppingSplit.id,
    });

    const refund1Response = await helpers.createTransaction({
      payload: refund1Payload,
      raw: false,
    });

    expect(refund1Response.statusCode).toBe(200);

    // Second partial refund: another $20 of the $40 split (total now $40)
    const refund2Payload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: shoppingCategory.id,
      amount: 2000, // $20
      transactionType: TRANSACTION_TYPES.income,
      refundForTxId: expenseTx.id,
      refundForSplitId: shoppingSplit.id,
    });

    const refund2Response = await helpers.createTransaction({
      payload: refund2Payload,
      raw: false,
    });

    expect(refund2Response.statusCode).toBe(200);

    // Third refund should fail - would exceed split amount
    const refund3Payload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: shoppingCategory.id,
      amount: 100, // $1 - would exceed the $40 limit
      transactionType: TRANSACTION_TYPES.income,
      refundForTxId: expenseTx.id,
      refundForSplitId: shoppingSplit.id,
    });

    const refund3Response = await helpers.createTransaction({
      payload: refund3Payload,
      raw: false,
    });

    expect(refund3Response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('should reject every invalid split-refund payload', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const foodCategory = categories[0]!;
    const shoppingCategory = categories[1]!;

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: foodCategory.id,
        amount: 10000,
        transactionType: TRANSACTION_TYPES.expense,
        splits: [{ categoryId: shoppingCategory.id, amount: 4000 }],
      }),
      raw: false,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: foodCategory.id,
        amount: 5000,
        transactionType: TRANSACTION_TYPES.expense,
        splits: [{ categoryId: shoppingCategory.id, amount: 2000 }],
      }),
      raw: false,
    });

    const transactions = await helpers.getTransactions({
      raw: true,
      includeSplits: true,
    });
    const tx1 = transactions!.find((t) => Number(t.amount) === 10000)!;
    const tx2 = transactions!.find((t) => Number(t.amount) === 5000)!;
    const splitFromTx1 = tx1.splits![0]!;
    const splitFromTx2 = tx2.splits![0]!;

    const overSplitRes = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: shoppingCategory.id,
        amount: 5000,
        transactionType: TRANSACTION_TYPES.income,
        refundForTxId: tx1.id,
        refundForSplitId: splitFromTx1.id,
      }),
      raw: false,
    });
    expect(overSplitRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const orphanSplitRes = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: foodCategory.id,
          amount: 4000,
          transactionType: TRANSACTION_TYPES.income,
        }),
        refundForSplitId: generateRandomRecordId(),
      },
      raw: false,
    });
    expect(orphanSplitRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const missingSplitRes = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: shoppingCategory.id,
        amount: 4000,
        transactionType: TRANSACTION_TYPES.income,
        refundForTxId: tx1.id,
        refundForSplitId: NONEXISTENT_ID,
      }),
      raw: false,
    });
    expect(missingSplitRes.statusCode).toBe(ERROR_CODES.NotFoundError);

    const foreignSplitRes = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: shoppingCategory.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.income,
        refundForTxId: tx1.id,
        refundForSplitId: splitFromTx2.id,
      }),
      raw: false,
    });
    expect(foreignSplitRes.statusCode).toBe(ERROR_CODES.ValidationError);
  }, 30000);
});

const getFirstSplit = async ({ transactionId }: { transactionId: string }) => {
  const transactions = await helpers.getTransactions({
    raw: true,
    includeSplits: true,
  });
  return transactions!.find((tx) => tx.id === transactionId)!.splits![0]!;
};

const refundSplit = async ({
  accountId,
  categoryId,
  amount,
  originalTxId,
  splitId,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  originalTxId: RecordId;
  splitId: RecordId;
}) => {
  const [refundTx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId,
      amount,
      transactionType: TRANSACTION_TYPES.income,
    }),
    raw: true,
  });

  const response = await helpers.createSingleRefund({
    originalTxId,
    refundTxId: refundTx.id,
    splitId,
  });

  return { refundTx, response };
};

/**
 * Updating a transaction replaces every split row, so refunds that targeted the old splits
 * must be re-pointed at the new ones. A lost link silently downgrades a split-level refund
 * to a transaction-level one, which moves the refunded money onto the transaction's primary
 * category in the stats breakdowns and drops the per-split over-refund ceiling.
 */
describe('Split-targeted refunds across transaction updates', () => {
  const TX_AMOUNT = 10000;

  /** $100 expense on the primary category with a split carved out for a second category. */
  const createSplitExpense = async ({ splitAmount }: { splitAmount: number }) => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const primaryCategory = categories[0]!;
    const splitCategory = categories[1]!;
    const spareCategory = categories[2]!;

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: primaryCategory.id,
        amount: TX_AMOUNT,
        transactionType: TRANSACTION_TYPES.expense,
        splits: [{ categoryId: splitCategory.id, amount: splitAmount }],
      }),
      raw: true,
    });

    const split = await getFirstSplit({ transactionId: expenseTx.id });

    return {
      account,
      primaryCategory,
      splitCategory,
      spareCategory,
      expenseTx,
      split,
    };
  };

  it('re-points the refund at the recreated split and keeps its stats attribution after an update', async () => {
    const { account, primaryCategory, splitCategory, expenseTx, split } = await createSplitExpense({
      splitAmount: 4000,
    });

    const { refundTx } = await refundSplit({
      accountId: account.id,
      categoryId: splitCategory.id,
      amount: 4000,
      originalTxId: expenseTx.id,
      splitId: split.id,
    });

    // Editing an unrelated field still re-sends the splits, which recreates the rows
    const updateRes = await helpers.updateTransaction({
      id: expenseTx.id,
      payload: {
        note: 'Updated note',
        splits: [{ categoryId: splitCategory.id, amount: 4000 }],
      },
      raw: false,
    });
    expect(updateRes.statusCode).toBe(200);

    const newSplit = await getFirstSplit({ transactionId: expenseTx.id });
    expect(newSplit.id).not.toBe(split.id);

    const refundLink = await helpers.getSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id }, true);
    expect(refundLink.splitId).toBe(newSplit.id);

    const stats = await helpers.getSpendingsByCategories({ raw: true });

    // Primary: 10000 - 4000 split = 6000, untouched by a refund that targets the split
    expect(stats[primaryCategory.id].amount).toBe(6000);
    // Split: 4000 - 4000 refund = 0
    expect(stats[splitCategory.id].amount).toBe(0);
  });

  it('still enforces the per-split refund ceiling after the update', async () => {
    const { account, splitCategory, expenseTx, split } = await createSplitExpense({ splitAmount: 4000 });

    await refundSplit({
      accountId: account.id,
      categoryId: splitCategory.id,
      amount: 2500,
      originalTxId: expenseTx.id,
      splitId: split.id,
    });

    await helpers.updateTransaction({
      id: expenseTx.id,
      payload: { splits: [{ categoryId: splitCategory.id, amount: 4000 }] },
      raw: false,
    });

    const newSplit = await getFirstSplit({ transactionId: expenseTx.id });

    // 2500 already refunded + 2500 exceeds the 4000 split
    const { response } = await refundSplit({
      accountId: account.id,
      categoryId: splitCategory.id,
      amount: 2500,
      originalTxId: expenseTx.id,
      splitId: newSplit.id,
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('lets a split shrink down to its refunded share, but not below it', async () => {
    const { account, splitCategory, expenseTx, split } = await createSplitExpense({ splitAmount: 50 });

    const [refundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: splitCategory.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    await helpers.createSingleRefund(
      { originalTxId: expenseTx.id, refundTxId: refundTx.id, splitId: split.id, amount: 20 },
      true,
    );

    const toShare = await helpers.updateTransaction({
      id: expenseTx.id,
      payload: { splits: [{ categoryId: splitCategory.id, amount: 30 }] },
      raw: false,
    });
    expect(toShare.statusCode).toBe(200);

    const belowShare = await helpers.updateTransaction({
      id: expenseTx.id,
      payload: { splits: [{ categoryId: splitCategory.id, amount: 10 }] },
      raw: false,
    });
    expect(belowShare.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(
      helpers.extractResponse(belowShare as unknown as helpers.CustomResponse<helpers.ErrorResponse>).message,
    ).toContain('cannot be greater than the split amount');
    expect((await getFirstSplit({ transactionId: expenseTx.id })).amount).toBe(30);
  });

  it('moves the refund to transaction level when its category is dropped from the update', async () => {
    const { account, primaryCategory, splitCategory, spareCategory, expenseTx, split } = await createSplitExpense({
      splitAmount: 4000,
    });

    const { refundTx } = await refundSplit({
      accountId: account.id,
      categoryId: splitCategory.id,
      amount: 4000,
      originalTxId: expenseTx.id,
      splitId: split.id,
    });

    await helpers.updateTransaction({
      id: expenseTx.id,
      payload: { splits: [{ categoryId: spareCategory.id, amount: 4000 }] },
      raw: false,
    });

    const refundLink = await helpers.getSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id }, true);
    expect(refundLink.splitId).toBeNull();

    const stats = await helpers.getSpendingsByCategories({ raw: true });

    // Primary: 6000 after the split, minus the now transaction-level 4000 refund
    expect(stats[primaryCategory.id].amount).toBe(2000);
    expect(stats[spareCategory.id].amount).toBe(4000);
    expect(stats[splitCategory.id]).toBeUndefined();
  });

  it('moves the refund to transaction level when all splits are cleared', async () => {
    const { account, primaryCategory, splitCategory, expenseTx, split } = await createSplitExpense({
      splitAmount: 4000,
    });

    const { refundTx } = await refundSplit({
      accountId: account.id,
      categoryId: splitCategory.id,
      amount: 4000,
      originalTxId: expenseTx.id,
      splitId: split.id,
    });

    await helpers.updateTransaction({
      id: expenseTx.id,
      payload: { splits: [] },
      raw: false,
    });

    const refundLink = await helpers.getSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundTx.id }, true);
    expect(refundLink.splitId).toBeNull();

    const stats = await helpers.getSpendingsByCategories({ raw: true });

    // Whole 10000 back on the primary category, minus the 4000 refund
    expect(stats[primaryCategory.id].amount).toBe(6000);
    expect(stats[splitCategory.id]).toBeUndefined();
  });
});
