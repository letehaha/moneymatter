import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('Statistics with transaction splits', () => {
  describe('getSpendingsByCategories with splits', () => {
    it('should handle multiple splits correctly', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const primaryCategory = categories[0]!;
      const splitCategory1 = categories[1]!;
      const splitCategory2 = categories[2]!;

      // Create $100 transaction with $30 split and $25 split
      // Stats should show: $45 primary, $30 split1, $25 split2
      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: primaryCategory.id,
        amount: 10000,
        transactionType: TRANSACTION_TYPES.expense,
        splits: [
          { categoryId: splitCategory1.id, amount: 3000 },
          { categoryId: splitCategory2.id, amount: 2500 },
        ],
      });

      await helpers.createTransaction({ payload: txPayload, raw: false });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      expect(stats[primaryCategory.id.toString()]).toEqual({
        name: primaryCategory.name,
        color: primaryCategory.color,
        amount: 4500,
      });
      expect(stats[splitCategory1.id.toString()]).toEqual({
        name: splitCategory1.name,
        color: splitCategory1.color,
        amount: 3000,
      });
      expect(stats[splitCategory2.id.toString()]).toEqual({
        name: splitCategory2.name,
        color: splitCategory2.color,
        amount: 2500,
      });
    });

    it('should handle transaction where splits consume entire amount', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const primaryCategory = categories[0]!;
      const splitCategory1 = categories[1]!;
      const splitCategory2 = categories[2]!;

      // Create $100 transaction with splits totaling $100
      // Primary category should get $0 (not appear in stats)
      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: primaryCategory.id,
        amount: 10000,
        transactionType: TRANSACTION_TYPES.expense,
        splits: [
          { categoryId: splitCategory1.id, amount: 6000 },
          { categoryId: splitCategory2.id, amount: 4000 },
        ],
      });

      await helpers.createTransaction({ payload: txPayload, raw: false });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Primary category should not appear (amount is 0)
      expect(stats[primaryCategory.id.toString()]).toBeUndefined();
      // Splits should have their amounts
      expect(stats[splitCategory1.id.toString()].amount).toBe(6000);
      expect(stats[splitCategory2.id.toString()].amount).toBe(4000);
    });

    it('should aggregate across transactions with and without splits', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const categoryA = categories[0]!;
      const categoryB = categories[1]!;

      // Transaction 1: $100 for A (no splits)
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: false,
      });

      // Transaction 2: $50 for A with $20 split for B
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: categoryB.id, amount: 2000 }],
        }),
        raw: false,
      });

      // Transaction 3: $50 for B with $15 split for A
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryB.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: categoryA.id, amount: 1500 }],
        }),
        raw: false,
      });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Category A: 10000 (tx1) + 3000 (tx2 primary) + 1500 (tx3 split) = 14500
      expect(stats[categoryA.id.toString()].amount).toBe(14500);
      // Category B: 2000 (tx2 split) + 3500 (tx3 primary) = 5500
      expect(stats[categoryB.id.toString()].amount).toBe(5500);
    });
  });

  describe('Refunds with splits', () => {
    it('should correctly handle refund on transaction with splits', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const categoryA = categories[0]!;
      const categoryB = categories[1]!;

      // Create $100 expense for A with $30 split for B
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: categoryB.id, amount: 3000 }],
        }),
        raw: true,
      });

      // Create $50 income that refunds the expense
      const [incomeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      // Link as refund
      await helpers.createSingleRefund({
        originalTxId: expenseTx.id,
        refundTxId: incomeTx.id,
      });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Category A: 7000 (primary) - 5000 (refund) = 2000
      expect(stats[categoryA.id.toString()].amount).toBe(2000);
      // Category B: 3000 (split, unaffected by refund on primary)
      expect(stats[categoryB.id.toString()].amount).toBe(3000);
    });

    it('should clamp a category to zero when its refund exceeds its own spend', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const categoryA = categories[0]!;
      const categoryB = categories[1]!;

      // Create $100 expense for A with $30 split for B
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: categoryB.id, amount: 3000 }],
        }),
        raw: true,
      });

      // Create $80 income refund (more than primary amount of $70)
      const [incomeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: categoryA.id,
          amount: 8000,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      await helpers.createSingleRefund({
        originalTxId: expenseTx.id,
        refundTxId: incomeTx.id,
      });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Category A: 7000 - 8000 floors at 0, the response carries expense magnitudes.
      expect(stats[categoryA.id.toString()].amount).toBe(0);
      // Category B: 3000 (split unaffected)
      expect(stats[categoryB.id.toString()].amount).toBe(3000);
    });

    describe('refunds targeting specific splits (splitId)', () => {
      it('should handle multiple refunds on different splits of same transaction', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();
        const categoryA = categories[0]!;
        const categoryB = categories[1]!;
        const categoryC = categories[2]!;

        // Create $100 expense: $50 primary (A) + $30 split (B) + $20 split (C)
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryA.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [
              { categoryId: categoryB.id, amount: 3000 },
              { categoryId: categoryC.id, amount: 2000 },
            ],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
        });
        const splitB = transactions![0]!.splits!.find((s) => s.categoryId === categoryB.id)!;
        const splitC = transactions![0]!.splits!.find((s) => s.categoryId === categoryC.id)!;

        // Refund $15 on split B
        const [refundB] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryB.id,
            amount: 1500,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundB.id,
          splitId: splitB.id,
        });

        // Refund $10 on split C
        const [refundC] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryC.id,
            amount: 1000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundC.id,
          splitId: splitC.id,
        });

        const stats = await helpers.getSpendingsByCategories({ raw: true });

        // Category A: 5000 (primary, unaffected)
        expect(stats[categoryA.id.toString()].amount).toBe(5000);
        // Category B: 3000 - 1500 = 1500
        expect(stats[categoryB.id.toString()].amount).toBe(1500);
        // Category C: 2000 - 1000 = 1000
        expect(stats[categoryC.id.toString()].amount).toBe(1000);
      });

      it('should handle split and transaction level refunds independently, down to a fully refunded split', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();
        const categoryA = categories[0]!;
        const categoryB = categories[1]!;

        // Create $100 expense: $70 primary (A) + $30 split (B)
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryA.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categoryB.id, amount: 3000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
        });
        const split = transactions![0]!.splits![0]!;

        const refundSplit = async ({ amount }: { amount: number }) => {
          const [refundTx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              categoryId: categoryB.id,
              amount,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });
          await helpers.createSingleRefund({
            originalTxId: expenseTx.id,
            refundTxId: refundTx.id,
            splitId: split.id,
          });
        };

        // Refund $20 on the split (category B)
        await refundSplit({ amount: 2000 });

        let stats = await helpers.getSpendingsByCategories({ raw: true });
        expect(stats[categoryA.id.toString()].amount).toBe(7000);
        // Category B: 3000 (split) - 2000 (refund) = 1000
        expect(stats[categoryB.id.toString()].amount).toBe(1000);

        // Refund $30 on the whole transaction
        const [primaryRefund] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryA.id,
            amount: 3000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: primaryRefund.id,
        });

        stats = await helpers.getSpendingsByCategories({ raw: true });
        // Category A: 7000 (primary) - 3000 (refund) = 4000
        expect(stats[categoryA.id.toString()].amount).toBe(4000);
        // The transaction-level refund must not leak onto the split category
        expect(stats[categoryB.id.toString()].amount).toBe(1000);

        await refundSplit({ amount: 1000 });

        stats = await helpers.getSpendingsByCategories({ raw: true });
        expect(stats[categoryA.id.toString()].amount).toBe(4000);
        // Category B: 3000 - 3000 = 0 (fully refunded)
        expect(stats[categoryB.id.toString()].amount).toBe(0);
      }, 30000);

      it('should correctly aggregate stats with multiple transactions having split refunds', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();
        const categoryA = categories[0]!;
        const categoryB = categories[1]!;

        // Transaction 1: $100 with $30 split
        const [tx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryA.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categoryB.id, amount: 3000 }],
          }),
          raw: true,
        });

        // Transaction 2: $50 with $20 split
        const [tx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryA.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categoryB.id, amount: 2000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
        });
        const split1 = transactions!.find((t) => t.id === tx1.id)!.splits![0]!;
        const split2 = transactions!.find((t) => t.id === tx2.id)!.splits![0]!;

        // Refund $15 from tx1's split
        const [refund1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryB.id,
            amount: 1500,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: tx1.id,
          refundTxId: refund1.id,
          splitId: split1.id,
        });

        // Refund $10 from tx2's split
        const [refund2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categoryB.id,
            amount: 1000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: tx2.id,
          refundTxId: refund2.id,
          splitId: split2.id,
        });

        const stats = await helpers.getSpendingsByCategories({ raw: true });

        // Category A: 7000 (tx1 primary) + 3000 (tx2 primary) = 10000
        expect(stats[categoryA.id.toString()].amount).toBe(10000);
        // Category B: (3000 - 1500) + (2000 - 1000) = 1500 + 1000 = 2500
        expect(stats[categoryB.id.toString()].amount).toBe(2500);
      });
    });
  });

  describe('Nested categories with splits', () => {
    it('should roll up split amounts to root category', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      // Find a root category and one of its children
      const rootCategory = categories.find((c) => !c.parentId)!;
      const childCategory = categories.find((c) => c.parentId === rootCategory.id)!;
      const otherRootCategory = categories.find((c) => !c.parentId && c.id !== rootCategory.id)!;

      // Create $100 expense for root with $30 split for child of same root
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: rootCategory.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: childCategory.id, amount: 3000 }],
        }),
        raw: false,
      });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Both primary and split should roll up to root category
      // Root category: 7000 (primary) + 3000 (child split) = 10000
      expect(stats[rootCategory.id.toString()].amount).toBe(10000);
      // Other categories should not appear
      expect(stats[otherRootCategory.id.toString()]).toBeUndefined();
    });

    it('should correctly split amounts across different root categories', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();

      // Get two different root categories
      const rootCategories = categories.filter((c) => !c.parentId).slice(0, 2);
      const rootA = rootCategories[0]!;
      const rootB = rootCategories[1]!;

      // Find a child of rootB
      const childOfB = categories.find((c) => c.parentId === rootB.id) || rootB;

      // Create $100 expense for rootA with $40 split for child of rootB
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: rootA.id,
          amount: 10000,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ categoryId: childOfB.id, amount: 4000 }],
        }),
        raw: false,
      });

      const stats = await helpers.getSpendingsByCategories({ raw: true });

      // Root A: 6000 (primary amount minus split)
      expect(stats[rootA.id.toString()].amount).toBe(6000);
      // Root B: 4000 (split rolled up from child)
      expect(stats[rootB.id.toString()].amount).toBe(4000);
    });
  });
});
