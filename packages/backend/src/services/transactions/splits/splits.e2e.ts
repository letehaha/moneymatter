import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const postTransaction = (payload: ReturnType<typeof helpers.buildTransactionPayload>) =>
  helpers.createTransaction({ payload, raw: false });

const readSplits = async () => (await helpers.getTransactions({ raw: true }))![0]!;

describe('Create transaction with splits', () => {
  it('should create transaction with a single split', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const primaryCategory = categories[0]!;
    const splitCategory = categories[1]!;

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: primaryCategory.id,
      amount: 1000,
      splits: [{ categoryId: splitCategory.id, amount: 400 }],
    });

    const response = await helpers.createTransaction({
      payload: txPayload,
      raw: false,
    });

    expect(response.statusCode).toBe(200);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    expect(transactions).toHaveLength(1);
    const txWithSplits = transactions![0]!;

    expect(txWithSplits.splits).toHaveLength(1);
    expect(txWithSplits.splits![0]!.categoryId).toBe(splitCategory.id);
    expect(txWithSplits.splits![0]!.amount).toBe(400);
  });

  it('should create transaction with multiple splits', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const primaryCategory = categories[0]!;
    const splitCategory1 = categories[1]!;
    const splitCategory2 = categories[2]!;

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: primaryCategory.id,
      amount: 1000,
      splits: [
        { categoryId: splitCategory1.id, amount: 300 },
        { categoryId: splitCategory2.id, amount: 200 },
      ],
    });

    const response = await helpers.createTransaction({
      payload: txPayload,
      raw: false,
    });

    expect(response.statusCode).toBe(200);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    expect(transactions).toHaveLength(1);
    const txWithSplits = transactions![0]!;

    expect(txWithSplits.splits).toHaveLength(2);
    expect(txWithSplits.splits!.map((s) => s.amount).toSorted()).toEqual([200, 300]);
  });

  it('should create transaction with splits having notes', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: categories[0]!.id,
      amount: 1000,
      splits: [{ categoryId: categories[1]!.id, amount: 400, note: 'Test split note' }],
    });

    const response = await helpers.createTransaction({
      payload: txPayload,
      raw: false,
    });

    expect(response.statusCode).toBe(200);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    expect(transactions![0]!.splits![0]!.note).toBe('Test split note');
  });

  it('should reject every invalid split payload and persist nothing', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    const transferRes = await postTransaction({
      ...helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 1000,
      destinationAccountId: accountB.id,
      splits: [{ categoryId: categories[1]!.id, amount: 400 }],
    });
    expect(transferRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const exceedsRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [
          { categoryId: categories[1]!.id, amount: 600 },
          { categoryId: categories[2]!.id, amount: 600 },
        ],
      }),
    );
    expect(exceedsRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const belowMinimumRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [{ categoryId: categories[1]!.id, amount: 0 }],
      }),
    );
    expect(belowMinimumRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const duplicateCategoryRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [
          { categoryId: categories[1]!.id, amount: 300 },
          { categoryId: categories[1]!.id, amount: 200 },
        ],
      }),
    );
    expect(duplicateCategoryRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const tooManyRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: Array.from({ length: 11 }, (_, i) => ({
          categoryId: categories[i % categories.length]!.id,
          amount: 10,
        })),
      }),
    );
    expect(tooManyRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const unknownCategoryRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [{ categoryId: generateRandomRecordId(), amount: 400 }],
      }),
    );
    expect(unknownCategoryRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const longNoteRes = await postTransaction(
      helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [{ categoryId: categories[1]!.id, amount: 400, note: 'a'.repeat(101) }],
      }),
    );
    expect(longNoteRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const transactions = await helpers.getTransactions({
      raw: true,
    });
    expect(transactions).toHaveLength(0);
  }, 30000);

  it('should allow primary category to receive remaining amount after splits', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const primaryCategory = categories[0]!;

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: primaryCategory.id,
      amount: 1000,
      splits: [{ categoryId: categories[1]!.id, amount: 400 }],
    });

    const response = await helpers.createTransaction({
      payload: txPayload,
      raw: false,
    });

    expect(response.statusCode).toBe(200);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    const txWithSplits = transactions![0]!;

    expect(txWithSplits.amount).toBe(1000);
    expect(txWithSplits.splits![0]!.amount).toBe(400);
  });

  it('should calculate refAmount for splits in different currency', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });

    const account = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: 'UAH',
      },
      raw: true,
    });

    const categories = await helpers.getCategoriesList();

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: categories[0]!.id,
      amount: 1000,
      splits: [{ categoryId: categories[1]!.id, amount: 400 }],
    });

    const response = await helpers.createTransaction({
      payload: txPayload,
      raw: false,
    });

    expect(response.statusCode).toBe(200);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    const txWithSplits = transactions![0]!;
    const currencyRate = (await helpers.getCurrenciesRates()).find((c) => c.baseCode === 'UAH');

    expect(txWithSplits.splits![0]!.refAmount).toEqualRefValue(400 * currencyRate!.rate);
  });
});

describe('Update transaction with splits', () => {
  it('should add, preserve, replace and clear splits across successive updates', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: categories[0]!.id,
        amount: 1000,
      }),
      raw: false,
    });

    const created = await readSplits();
    const txId = created.id;
    expect(created.splits).toHaveLength(0);

    const addRes = await helpers.updateTransaction({
      id: txId,
      payload: { splits: [{ categoryId: categories[1]!.id, amount: 400 }] },
      raw: false,
    });
    expect(addRes.statusCode).toBe(200);

    const afterAdd = await readSplits();
    expect(afterAdd.splits).toHaveLength(1);
    expect(afterAdd.splits![0]!.amount).toBe(400);
    const originalSplitId = afterAdd.splits![0]!.id;

    const noteRes = await helpers.updateTransaction({
      id: txId,
      payload: { note: 'Updated note' },
      raw: false,
    });
    expect(noteRes.statusCode).toBe(200);

    const afterNote = await readSplits();
    expect(afterNote.splits).toHaveLength(1);
    expect(afterNote.splits![0]!.id).toBe(originalSplitId);

    const replaceRes = await helpers.updateTransaction({
      id: txId,
      payload: {
        splits: [
          { categoryId: categories[2]!.id, amount: 200 },
          { categoryId: categories[3]!.id, amount: 150 },
        ],
      },
      raw: false,
    });
    expect(replaceRes.statusCode).toBe(200);

    const afterReplace = await readSplits();
    expect(afterReplace.splits).toHaveLength(2);
    expect(afterReplace.splits!.every((s) => s.id !== originalSplitId)).toBe(true);

    const nullRes = await helpers.updateTransaction({
      id: txId,
      payload: { splits: null },
      raw: false,
    });
    expect(nullRes.statusCode).toBe(200);
    expect((await readSplits()).splits).toHaveLength(0);

    await helpers.updateTransaction({
      id: txId,
      payload: { splits: [{ categoryId: categories[1]!.id, amount: 400 }] },
      raw: false,
    });

    const emptyRes = await helpers.updateTransaction({
      id: txId,
      payload: { splits: [] },
      raw: false,
    });
    expect(emptyRes.statusCode).toBe(200);
    expect((await readSplits()).splits).toHaveLength(0);

    await helpers.updateTransaction({
      id: txId,
      payload: { splits: [{ categoryId: categories[1]!.id, amount: 400 }] },
      raw: false,
    });

    const amountRes = await helpers.updateTransaction({
      id: txId,
      payload: {
        amount: 2000,
        splits: [{ categoryId: categories[1]!.id, amount: 800 }],
      },
      raw: false,
    });
    expect(amountRes.statusCode).toBe(200);

    const afterAmount = await readSplits();
    expect(afterAmount.amount).toBe(2000);
    expect(afterAmount.splits![0]!.amount).toBe(800);
  }, 30000);

  it('should reject invalid split updates', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [{ categoryId: categories[1]!.id, amount: 400 }],
      }),
      raw: false,
    });

    const transactions = await helpers.getTransactions({
      raw: true,
    });
    const txId = transactions![0]!.id;

    const transferRes = await helpers.updateTransaction({
      id: txId,
      payload: {
        destinationAccountId: accountB.id,
        destinationAmount: 1000,
        splits: [{ categoryId: categories[1]!.id, amount: 400 }],
      },
      raw: false,
    });
    expect(transferRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const exceedsRes = await helpers.updateTransaction({
      id: txId,
      payload: {
        splits: [
          { categoryId: categories[1]!.id, amount: 600 },
          { categoryId: categories[2]!.id, amount: 600 },
        ],
      },
      raw: false,
    });
    expect(exceedsRes.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});

describe('Delete transaction splits', () => {
  it('should delete splits one by one and leave the transaction amount alone', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [
          { categoryId: categories[1]!.id, amount: 300 },
          { categoryId: categories[2]!.id, amount: 200 },
        ],
      }),
      raw: false,
    });

    const transactions = await helpers.getTransactions({
      raw: true,
    });
    expect(transactions).toHaveLength(1);
    expect(transactions![0]!.splits).toHaveLength(2);

    const originalAmount = transactions![0]!.amount;
    const firstSplit = transactions![0]!.splits![0]!;
    const secondSplit = transactions![0]!.splits![1]!;

    const firstDeleteRes = await helpers.deleteSplit({
      splitId: firstSplit.id,
    });
    expect(firstDeleteRes.statusCode).toBe(200);

    const afterFirst = await helpers.getTransactions({
      raw: true,
    });
    expect(afterFirst![0]!.splits).toHaveLength(1);
    expect(afterFirst![0]!.splits![0]!.id).not.toBe(firstSplit.id);
    expect(afterFirst![0]!.splits![0]!.id).toBe(secondSplit.id);

    const lastDeleteRes = await helpers.deleteSplit({
      splitId: secondSplit.id,
    });
    expect(lastDeleteRes.statusCode).toBe(200);

    const afterLast = await helpers.getTransactions({
      raw: true,
    });
    expect(afterLast![0]!.splits).toHaveLength(0);
    expect(afterLast![0]!.amount).toBe(originalAmount);
  });

  it('should reject deleting non-existent split', async () => {
    const fakeUuid = generateRandomRecordId();

    const deleteRes = await helpers.deleteSplit({ splitId: fakeUuid });
    // Should return error status (404 NotFound or 422 if validation layer catches it first)
    expect(deleteRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(deleteRes.statusCode).toBeLessThan(500);
  });

  describe('splits with refunds', () => {
    it('should reject deleting a split with a refund and allow it once the refund is unlinked', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[0]!.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: categories[1]!.id, amount: 3000 }],
        }),
        raw: true,
      });

      const transactions = await helpers.getTransactions({
        raw: true,
      });
      const split = transactions![0]!.splits![0]!;

      const [refundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[1]!.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      await helpers.createSingleRefund({
        originalTxId: expenseTx.id,
        refundTxId: refundTx.id,
        splitId: split.id,
      });

      const blockedRes = await helpers.deleteSplit({ splitId: split.id });
      expect(blockedRes.statusCode).toEqual(ERROR_CODES.ValidationError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((blockedRes.body.response as any).message).toContain('Cannot delete split that has refunds');

      await helpers.deleteRefund({
        originalTxId: expenseTx.id,
        refundTxId: refundTx.id,
      });

      const allowedRes = await helpers.deleteSplit({ splitId: split.id });
      expect(allowedRes.statusCode).toBe(200);

      const updatedTransactions = await helpers.getTransactions({
        raw: true,
      });

      expect(updatedTransactions!.find((t) => t.id === expenseTx.id)!.splits).toHaveLength(0);
    });

    it('should allow deleting split without refund when sibling split has refund', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      // Create expense transaction with two splits
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[0]!.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [
            { categoryId: categories[1]!.id, amount: 3000 },
            { categoryId: categories[2]!.id, amount: 2000 },
          ],
        }),
        raw: true,
      });

      const transactions = await helpers.getTransactions({
        raw: true,
      });
      const split1 = transactions![0]!.splits![0]!;
      const split2 = transactions![0]!.splits![1]!;

      // Create refund targeting only the first split
      const [refundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categories[1]!.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      await helpers.createSingleRefund({
        originalTxId: expenseTx.id,
        refundTxId: refundTx.id,
        splitId: split1.id,
      });

      // Deleting split2 (which has no refund) should work
      const deleteRes = await helpers.deleteSplit({ splitId: split2.id });

      expect(deleteRes.statusCode).toBe(200);

      // Verify only split2 was deleted
      const updatedTransactions = await helpers.getTransactions({
        raw: true,
      });

      const updatedExpenseTx = updatedTransactions!.find((t) => t.id === expenseTx.id);
      expect(updatedExpenseTx!.splits).toHaveLength(1);
      expect(updatedExpenseTx!.splits![0]!.id).toBe(split1.id);
    });
  });
});

describe('Query transactions with splits', () => {
  it('returns splits with their category by default and an empty array for unsplit rows', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [{ categoryId: categories[1]!.id, amount: 400, note: 'Split note' }],
      }),
      raw: false,
    });

    const included = await helpers.getTransactions({
      raw: true,
    });
    expect(included).toHaveLength(1);
    expect(included![0]!.splits).toBeDefined();
    expect(included![0]!.splits).toHaveLength(1);

    const split = included![0]!.splits![0]!;
    expect(split.categoryId).toBe(categories[1]!.id);
    expect(split.amount).toBe(400);
    expect(split.note).toBe('Split note');
    expect(split.category).toBeDefined();
    expect(split.category!.id).toBe(categories[1]!.id);

    const [plain] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });
    const rows = await helpers.getTransactions({ raw: true });
    expect(rows.find((tx) => tx.id === plain!.id)!.splits).toEqual([]);
  });

  it('should match on primary and split categories without duplicating the row', async () => {
    const account = await helpers.createAccount({ raw: true });
    const categories = await helpers.getCategoriesList();
    const primaryCategory = categories[0]!;
    const splitCategory = categories[1]!;

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: primaryCategory.id,
        amount: 1000,
        splits: [{ categoryId: splitCategory.id, amount: 400 }],
      }),
      raw: false,
    });

    const bySplitCategory = await helpers.getTransactions({
      raw: true,
      categoryIds: [splitCategory.id],
    });
    expect(bySplitCategory).toHaveLength(1);
    expect(bySplitCategory![0]!.categoryId).toBe(primaryCategory.id);
    expect(bySplitCategory![0]!.splits![0]!.categoryId).toBe(splitCategory.id);

    const byPrimaryCategory = await helpers.getTransactions({
      raw: true,
      categoryIds: [primaryCategory.id],
    });
    expect(byPrimaryCategory).toHaveLength(1);
    expect(byPrimaryCategory![0]!.categoryId).toBe(primaryCategory.id);

    const byBothCategories = await helpers.getTransactions({
      raw: true,
      categoryIds: [primaryCategory.id, splitCategory.id],
    });
    expect(byBothCategories).toHaveLength(1);

    const withOtherFilters = await helpers.getTransactions({
      raw: true,
      accountIds: [account.id],
      amountGte: Money.fromDecimal(100),
      amountLte: Money.fromDecimal(1000),
    });
    expect(withOtherFilters).toHaveLength(1);
    expect(withOtherFilters![0]!.splits).toHaveLength(1);
  });

  describe('Transaction deletion with splits', () => {
    it('should cascade delete splits when transaction is deleted', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits: [
          { categoryId: categories[1]!.id, amount: 300 },
          { categoryId: categories[2]!.id, amount: 200 },
        ],
      });

      await helpers.createTransaction({ payload: txPayload, raw: false });

      const transactions = await helpers.getTransactions({
        raw: true,
      });

      expect(transactions![0]!.splits).toHaveLength(2);
      const txId = transactions![0]!.id;

      // Delete the transaction
      const deleteRes = await helpers.deleteTransaction({ id: txId });
      expect(deleteRes.statusCode).toBe(200);

      // Verify transaction and splits are gone
      const remaining = await helpers.getTransactions({
        raw: true,
      });

      expect(remaining).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle exactly 10 splits (maximum allowed)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      // Need at least 11 categories (1 primary + 10 splits)
      const splitCategories = categories.slice(1, 11);
      expect(splitCategories.length).toBe(10);

      const splits = splitCategories.map((cat, index) => ({
        categoryId: cat!.id,
        amount: 50 + index, // 50, 51, 52... to make them unique and total < 1000
      }));

      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: categories[0]!.id,
        amount: 1000,
        splits,
      });

      const createRes = await helpers.createTransaction({
        payload: txPayload,
        raw: false,
      });

      expect(createRes.statusCode).toBe(200);

      const transactions = await helpers.getTransactions({
        raw: true,
      });

      expect(transactions![0]!.splits).toHaveLength(10);
    });
  });
});
