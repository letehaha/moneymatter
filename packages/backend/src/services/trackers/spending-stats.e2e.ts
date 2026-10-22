import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Get tracker spending stats', () => {
  it('returns empty stats for empty manual and category trackers', async () => {
    const manualTracker = await helpers.createTracker({
      name: 'empty-tracker',
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-31T23:59:59Z',
      raw: true,
    });

    const category = await helpers.addCustomCategory({
      name: 'EmptyCategory',
      color: '#999999',
      raw: true,
    });
    const categoryTracker = await helpers.createTracker({
      name: 'empty-category-tracker',
      rulesEnabled: true,
      categoryIds: [category.id],
      startDate: '2025-04-01T00:00:00Z',
      endDate: '2025-04-30T23:59:59Z',
      raw: true,
    });

    const manualResult = await helpers.getTrackerSpendingStats({
      id: manualTracker.id,
      raw: true,
    });
    expect(manualResult.spendingsByCategory).toEqual([]);
    expect(manualResult.spendingOverTime.periods).toEqual([]);
    expect(manualResult.spendingsByCurrency).toEqual([]);
    expect(manualResult.topPayees).toEqual([]);
    expect(manualResult.biggestDay).toBeNull();

    const categoryResult = await helpers.getTrackerSpendingStats({
      id: categoryTracker.id,
      raw: true,
    });
    expect(categoryResult.spendingsByCategory).toEqual([]);
    expect(categoryResult.spendingOverTime.periods).toEqual([]);
    expect(categoryResult.spendingsByCurrency).toEqual([]);
    expect(categoryResult.topPayees).toEqual([]);
    expect(categoryResult.biggestDay).toBeNull();
  }, 60_000);

  describe('Manual tracker', () => {
    it('returns spending stats for a manual tracker with transactions', async () => {
      const account = await helpers.createAccount({ raw: true });

      const category1 = await helpers.addCustomCategory({
        name: 'Food',
        color: '#FF0000',
        raw: true,
      });
      const category2 = await helpers.addCustomCategory({
        name: 'Transport',
        color: '#00FF00',
        raw: true,
      });

      // Create expense transactions with different categories (amounts are decimals)
      const [tx1] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          categoryId: category1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-15T10:00:00Z',
        }),
      });
      const [tx2] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          categoryId: category2.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-20T10:00:00Z',
        }),
      });
      const [tx3] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          categoryId: category1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-25T10:00:00Z',
        }),
      });

      // Create an income transaction
      const [tx4] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          categoryId: category1.id,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-03-10T10:00:00Z',
        }),
      });

      const tracker = await helpers.createTracker({
        name: 'test-spending-stats',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [tx1.id, tx2.id, tx3.id, tx4.id] },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      // Verify spendingsByCategory - expenses only, grouped by root category
      expect(result.spendingsByCategory).toHaveLength(2);

      // Sorted by amount descending: Food (500+200=700), Transport (300)
      expect(result.spendingsByCategory[0]!.categoryId).toBe(category1.id);
      expect(result.spendingsByCategory[0]!.name).toBe('Food');
      expect(result.spendingsByCategory[0]!.amount).toBe(700);
      expect(result.spendingsByCategory[1]!.categoryId).toBe(category2.id);
      expect(result.spendingsByCategory[1]!.name).toBe('Transport');
      expect(result.spendingsByCategory[1]!.amount).toBe(300);

      // Verify spendingOverTime
      expect(result.spendingOverTime.granularity).toBe('daily');
      expect(result.spendingOverTime.periods.length).toBeGreaterThan(0);

      // Sum of all period expenses should equal total expenses
      const totalExpense = result.spendingOverTime.periods.reduce((sum, p) => sum + p.expense, 0);
      expect(totalExpense).toBe(1000);

      // Sum of all period income should equal total income
      const totalIncome = result.spendingOverTime.periods.reduce((sum, p) => sum + p.income, 0);
      expect(totalIncome).toBe(1000);
    });

    it('returns subcategory breakdown for transactions under child categories', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Parent category
      const parentCategory = await helpers.addCustomCategory({
        name: 'Food',
        color: '#FF0000',
        raw: true,
      });
      // Child categories
      const childCategory1 = await helpers.addCustomCategory({
        name: 'Groceries',
        color: '#FF5555',
        parentId: parentCategory.id,
        raw: true,
      });
      const childCategory2 = await helpers.addCustomCategory({
        name: 'Dining Out',
        color: '#FF9999',
        parentId: parentCategory.id,
        raw: true,
      });
      // A separate root category (no children)
      const transportCategory = await helpers.addCustomCategory({
        name: 'Transport',
        color: '#00FF00',
        raw: true,
      });

      // Create expenses under child categories
      const [tx1] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          categoryId: childCategory1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-10T10:00:00Z',
        }),
      });
      const [tx2] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 250,
          categoryId: childCategory2.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-15T10:00:00Z',
        }),
      });
      // Expense directly under parent category (no child)
      const [tx3] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: parentCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-20T10:00:00Z',
        }),
      });
      // Expense under separate root category
      const [tx4] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          categoryId: transportCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-12T10:00:00Z',
        }),
      });

      const tracker = await helpers.createTracker({
        name: 'subcategory-test',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [tx1.id, tx2.id, tx3.id, tx4.id] },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      // Food (400+250+100=750) > Transport (300)
      expect(result.spendingsByCategory).toHaveLength(2);
      expect(result.spendingsByCategory[0]!.categoryId).toBe(parentCategory.id);
      expect(result.spendingsByCategory[0]!.name).toBe('Food');
      expect(result.spendingsByCategory[0]!.amount).toBe(750);

      // Food should have children (only subcategory transactions, not the direct parent one)
      const foodChildren = result.spendingsByCategory[0]!.children;
      expect(foodChildren).toBeDefined();
      expect(foodChildren).toHaveLength(2);
      // Sorted by amount descending: Groceries (400), Dining Out (250)
      expect(foodChildren![0]!.categoryId).toBe(childCategory1.id);
      expect(foodChildren![0]!.name).toBe('Groceries');
      expect(foodChildren![0]!.amount).toBe(400);
      expect(foodChildren![1]!.categoryId).toBe(childCategory2.id);
      expect(foodChildren![1]!.name).toBe('Dining Out');
      expect(foodChildren![1]!.amount).toBe(250);

      // Transport has no children
      expect(result.spendingsByCategory[1]!.categoryId).toBe(transportCategory.id);
      expect(result.spendingsByCategory[1]!.amount).toBe(300);
      expect(result.spendingsByCategory[1]!.children).toBeUndefined();
    });

    it('uses transaction date range when tracker has no dates', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({
        name: 'Misc',
        color: '#AAAAAA',
        raw: true,
      });

      const [tx1] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-06-01T10:00:00Z',
        }),
      });
      const [tx2] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-06-15T10:00:00Z',
        }),
      });

      // Tracker without dates
      const tracker = await helpers.createTracker({
        name: 'no-date-tracker',
        startDate: null,
        endDate: null,
        raw: true,
      });

      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [tx1.id, tx2.id] },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCategory).toHaveLength(1);
      expect(result.spendingOverTime.periods.length).toBeGreaterThan(0);
      expect(result.spendingOverTime.granularity).toBe('daily');
    });
  });

  describe('Category tracker', () => {
    it('returns spending stats for a category tracker', async () => {
      const account = await helpers.createAccount({ raw: true });

      const category1 = await helpers.addCustomCategory({
        name: 'Groceries',
        color: '#FF0000',
        raw: true,
      });
      const category2 = await helpers.addCustomCategory({
        name: 'Dining',
        color: '#00FF00',
        raw: true,
      });

      // Create transactions matching the tracker categories
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 800,
          categoryId: category1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-10T10:00:00Z',
        }),
      });
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          categoryId: category2.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-15T10:00:00Z',
        }),
      });

      const tracker = await helpers.createTracker({
        name: 'food-category-tracker',
        rulesEnabled: true,
        categoryIds: [category1.id, category2.id],
        startDate: '2025-04-01T00:00:00Z',
        endDate: '2025-04-30T23:59:59Z',
        limitAmount: 2000,
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCategory).toHaveLength(2);
      // Sorted by amount desc: Groceries (800), Dining (400)
      expect(result.spendingsByCategory[0]!.name).toBe('Groceries');
      expect(result.spendingsByCategory[0]!.amount).toBe(800);
      expect(result.spendingsByCategory[1]!.name).toBe('Dining');
      expect(result.spendingsByCategory[1]!.amount).toBe(400);

      expect(result.spendingOverTime.granularity).toBe('daily');
      expect(result.spendingOverTime.periods.length).toBeGreaterThan(0);
    });

    it('returns subcategory breakdown for category tracker with child categories', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Parent category (tracker target)
      const parentCategory = await helpers.addCustomCategory({
        name: 'Food',
        color: '#FF0000',
        raw: true,
      });
      // Child categories
      const childCategory1 = await helpers.addCustomCategory({
        name: 'Groceries',
        color: '#FF5555',
        parentId: parentCategory.id,
        raw: true,
      });
      const childCategory2 = await helpers.addCustomCategory({
        name: 'Dining Out',
        color: '#FF9999',
        parentId: parentCategory.id,
        raw: true,
      });

      // Expenses under child categories
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 600,
          categoryId: childCategory1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-10T10:00:00Z',
        }),
      });
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 350,
          categoryId: childCategory2.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-15T10:00:00Z',
        }),
      });

      // Tracker tracks the parent category (descendants auto-included)
      const tracker = await helpers.createTracker({
        name: 'food-subcategory-tracker',
        rulesEnabled: true,
        categoryIds: [parentCategory.id],
        startDate: '2025-04-01T00:00:00Z',
        endDate: '2025-04-30T23:59:59Z',
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCategory).toHaveLength(1);
      expect(result.spendingsByCategory[0]!.categoryId).toBe(parentCategory.id);
      expect(result.spendingsByCategory[0]!.amount).toBe(950);

      const children = result.spendingsByCategory[0]!.children;
      expect(children).toBeDefined();
      expect(children).toHaveLength(2);
      expect(children![0]!.categoryId).toBe(childCategory1.id);
      expect(children![0]!.name).toBe('Groceries');
      expect(children![0]!.amount).toBe(600);
      expect(children![1]!.categoryId).toBe(childCategory2.id);
      expect(children![1]!.name).toBe('Dining Out');
      expect(children![1]!.amount).toBe(350);
    });

    it('counts a split transaction in full when one split matches', async () => {
      const account = await helpers.createAccount({ raw: true });

      const category1 = await helpers.addCustomCategory({
        name: 'SplitCat1',
        color: '#FF0000',
        raw: true,
      });
      const category2 = await helpers.addCustomCategory({
        name: 'SplitCat2',
        color: '#00FF00',
        raw: true,
      });

      // Create a transaction with splits where only one split matches tracker category
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000, // $10.00 total
          categoryId: category1.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-05-10T10:00:00Z',
          splits: [
            { categoryId: category1.id, amount: 600 }, // $6.00
            { categoryId: category2.id, amount: 400 }, // $4.00
          ],
        }),
      });

      // Tracker only tracks category1
      const tracker = await helpers.createTracker({
        name: 'split-tracker',
        rulesEnabled: true,
        categoryIds: [category1.id],
        startDate: '2025-05-01T00:00:00Z',
        endDate: '2025-05-31T23:59:59Z',
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      // A matching split links the whole transaction, counted under its primary category.
      expect(result.spendingsByCategory).toHaveLength(1);
      expect(result.spendingsByCategory[0]!.name).toBe('SplitCat1');
      expect(result.spendingsByCategory[0]!.amount).toBe(1000);
    });
  });

  describe('Refund handling', () => {
    it('nets out refunds in the category breakdown and timeline, dropping fully refunded categories', async () => {
      const account = await helpers.createAccount({ raw: true });
      const travelCategory = await helpers.addCustomCategory({
        name: 'Travel',
        color: '#0000FF',
        raw: true,
      });
      const returnsCategory = await helpers.addCustomCategory({
        name: 'Returns',
        color: '#00FFFF',
        raw: true,
      });

      const [travelExpenseTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          categoryId: travelCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-10T10:00:00Z',
        }),
      });
      const [travelRefundTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          categoryId: travelCategory.id,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-04-12T10:00:00Z',
        }),
      });
      const [returnsExpenseTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          categoryId: returnsCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-04-05T10:00:00Z',
        }),
      });
      const [returnsRefundTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 400,
          categoryId: returnsCategory.id,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-04-06T10:00:00Z',
        }),
      });

      await helpers.createSingleRefund({ originalTxId: travelExpenseTx.id, refundTxId: travelRefundTx.id }, true);
      await helpers.createSingleRefund({ originalTxId: returnsExpenseTx.id, refundTxId: returnsRefundTx.id }, true);

      const tracker = await helpers.createTracker({
        name: 'spending-refund-test-manual',
        startDate: '2025-04-01T00:00:00Z',
        endDate: '2025-04-30T23:59:59Z',
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: {
          transactionIds: [travelExpenseTx.id, travelRefundTx.id, returnsExpenseTx.id, returnsRefundTx.id],
        },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      // Returns nets to zero, so the category is omitted entirely.
      expect(result.spendingsByCategory).toHaveLength(1);
      expect(result.spendingsByCategory[0]!.categoryId).toBe(travelCategory.id);
      expect(result.spendingsByCategory[0]!.amount).toBe(300);

      const totalExpense = result.spendingOverTime.periods.reduce((sum, p) => sum + p.expense, 0);
      const totalIncome = result.spendingOverTime.periods.reduce((sum, p) => sum + p.income, 0);
      expect(totalExpense).toBe(300);
      expect(totalIncome).toBe(0);
      expect(result.biggestDay).toEqual({ date: '2025-04-10', expense: 300 });
    }, 60_000);

    it('nets a split-targeted refund against the primary category the split transaction is counted under', async () => {
      const account = await helpers.createAccount({ raw: true });
      const primaryCategory = await helpers.addCustomCategory({
        name: 'Primary',
        color: '#111111',
        raw: true,
      });
      const splitCategory = await helpers.addCustomCategory({
        name: 'SplitCat',
        color: '#222222',
        raw: true,
      });

      // Expense $10 with $3 split in splitCategory; primary remainder ($7) stays in primaryCategory.
      const [expenseTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          categoryId: primaryCategory.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-07-10T10:00:00Z',
          splits: [{ categoryId: splitCategory.id, amount: 300 }],
        }),
      });

      const txWithSplits = await helpers.getTransactions({ raw: true, includeSplits: true });
      const split = txWithSplits.find((t) => t.id === expenseTx.id)!.splits![0]!;

      // Refund-income $3 targeting the $3 split.
      const [refundIncomeTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          categoryId: splitCategory.id,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-07-12T10:00:00Z',
        }),
      });

      await helpers.createSingleRefund(
        { originalTxId: expenseTx.id, refundTxId: refundIncomeTx.id, splitId: split.id },
        true,
      );

      const tracker = await helpers.createTracker({
        name: 'split-refund-category-tracker',
        rulesEnabled: true,
        categoryIds: [splitCategory.id],
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-31T23:59:59Z',
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCategory).toEqual([
        expect.objectContaining({ categoryId: primaryCategory.id, amount: 700 }),
      ]);
    });

    it('nets out refunds for a category tracker', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({
        name: 'Groceries',
        color: '#FFAA00',
        raw: true,
      });

      const [expenseTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 600,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-06-10T10:00:00Z',
        }),
      });
      const [refundIncomeTx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 250,
          categoryId: category.id,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-06-15T10:00:00Z',
        }),
      });

      await helpers.createSingleRefund({ originalTxId: expenseTx.id, refundTxId: refundIncomeTx.id }, true);

      const tracker = await helpers.createTracker({
        name: 'category-refund-tracker',
        rulesEnabled: true,
        categoryIds: [category.id],
        startDate: '2025-06-01T00:00:00Z',
        endDate: '2025-06-30T23:59:59Z',
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCategory).toHaveLength(1);
      // 600 expense - 250 refund-income = 350
      expect(result.spendingsByCategory[0]!.amount).toBe(350);
    });
  });

  describe('Granularity and biggest day', () => {
    it('buckets a 10-day tracker per day and picks the day with the highest expense', async () => {
      const account = await helpers.createAccount({ raw: true });
      const txs = await Promise.all(
        [
          { amount: 100, time: '2025-08-03T10:00:00Z' },
          { amount: 200, time: '2025-08-05T09:00:00Z' },
          { amount: 150, time: '2025-08-05T18:00:00Z' },
          { amount: 300, time: '2025-08-08T12:00:00Z' },
        ].map(({ amount, time }) =>
          helpers.createTransaction({
            raw: true,
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount,
              transactionType: TRANSACTION_TYPES.expense,
              time,
            }),
          }),
        ),
      );

      const tracker = await helpers.createTracker({
        name: 'daily-tracker',
        startDate: '2025-08-01T00:00:00Z',
        endDate: '2025-08-10T23:59:59Z',
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: txs.map(([tx]) => tx.id) },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingOverTime.granularity).toBe('daily');
      expect(result.spendingOverTime.periods).toHaveLength(10);
      result.spendingOverTime.periods.forEach((period) => expect(period.periodStart).toBe(period.periodEnd));
      expect(result.spendingOverTime.periods[4]).toMatchObject({ periodStart: '2025-08-05', expense: 350 });
      expect(result.biggestDay).toEqual({ date: '2025-08-05', expense: 350 });
    });

    it('buckets a 90-day tracker per week', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-02-10T10:00:00Z',
        }),
      });

      const tracker = await helpers.createTracker({
        name: 'weekly-tracker',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });
      await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx.id] } });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingOverTime.granularity).toBe('weekly');
      expect(result.biggestDay).toEqual({ date: '2025-02-10', expense: 100 });
    });

    it('picks granularity by inclusive calendar days', async () => {
      const account = await helpers.createAccount({ raw: true });
      const granularityFor = async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
        const [tx] = await helpers.createTransaction({
          raw: true,
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
            time: startDate,
          }),
        });
        const tracker = await helpers.createTracker({ name: 'granularity-tracker', startDate, endDate, raw: true });
        await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx!.id] } });
        const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });
        return result.spendingOverTime.granularity;
      };

      const firstHalf = await granularityFor({ startDate: '2025-01-01T00:00:00Z', endDate: '2025-06-30T23:59:59Z' });
      const secondHalf = await granularityFor({ startDate: '2025-07-01T00:00:00Z', endDate: '2025-12-31T23:59:59Z' });
      expect(firstHalf).toBe('weekly');
      expect(secondHalf).toBe(firstHalf);

      expect(await granularityFor({ startDate: '2025-07-01T00:00:00Z', endDate: '2025-08-31T23:59:59Z' })).toBe(
        'daily',
      );
      expect(await granularityFor({ startDate: '2025-07-01T00:00:00Z', endDate: '2025-09-01T23:59:59Z' })).toBe(
        'weekly',
      );
    });
  });

  describe('Spendings by currency', () => {
    it('groups expenses by the transaction currency, largest base amount first', async () => {
      const baseAccount = await helpers.createAccount({ raw: true });
      const {
        currencies: [foreignCurrency],
      } = await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true });
      const foreignAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), currencyCode: foreignCurrency!.currencyCode },
        raw: true,
      });

      const createExpense = async ({ accountId, amount }: { accountId: RecordId; amount: number }) => {
        const [tx] = await helpers.createTransaction({
          raw: true,
          payload: helpers.buildTransactionPayload({
            accountId,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            time: '2025-09-10T10:00:00Z',
          }),
        });
        return tx;
      };

      const baseTxs = [
        await createExpense({ accountId: baseAccount.id, amount: 100 }),
        await createExpense({ accountId: baseAccount.id, amount: 50 }),
      ];
      const foreignTxs = [
        await createExpense({ accountId: foreignAccount.id, amount: 4000 }),
        await createExpense({ accountId: foreignAccount.id, amount: 1000 }),
      ];

      const tracker = await helpers.createTracker({
        name: 'currency-tracker',
        startDate: '2025-09-01T00:00:00Z',
        endDate: '2025-09-30T23:59:59Z',
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [...baseTxs, ...foreignTxs].map((tx) => tx.id) },
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      const sumRef = (txs: typeof baseTxs) => txs.reduce((sum, tx) => sum + Number(tx.refAmount), 0);
      const expected = [
        { currencyCode: baseAccount.currencyCode, amount: 150, refAmount: sumRef(baseTxs) },
        { currencyCode: foreignCurrency!.currencyCode, amount: 5000, refAmount: sumRef(foreignTxs) },
      ].sort((a, b) => b.refAmount - a.refAmount);

      expect(result.spendingsByCurrency).toHaveLength(2);
      expected.forEach((item, index) => {
        expect(result.spendingsByCurrency[index]!.currencyCode).toBe(item.currencyCode);
        expect(result.spendingsByCurrency[index]!.amount).toBeCloseTo(item.amount, 2);
        expect(result.spendingsByCurrency[index]!.refAmount).toBeCloseTo(item.refAmount, 2);
      });
    });
  });

  describe('Split transactions in currency and payee breakdowns', () => {
    it('counts a split transaction once per payee and in full per currency', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [first, second] = await Promise.all(
        ['SplitPayeeCat1', 'SplitPayeeCat2'].map((name) =>
          helpers.addCustomCategory({ name, color: '#123456', raw: true }),
        ),
      );
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'stats-split-payee' }),
        raw: true,
      });
      await helpers.createTransaction({
        raw: true,
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: first!.id,
          payeeId: payee.id,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-11-10T10:00:00Z',
          splits: [
            { categoryId: first!.id, amount: 60 },
            { categoryId: second!.id, amount: 40 },
          ],
        }),
      });

      const tracker = await helpers.createTracker({
        name: 'split-payee-tracker',
        rulesEnabled: true,
        categoryIds: [first!.id, second!.id],
        startDate: '2025-11-01T00:00:00Z',
        endDate: '2025-11-30T23:59:59Z',
        raw: true,
      });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      expect(result.spendingsByCurrency).toHaveLength(1);
      expect(result.spendingsByCurrency[0]!.currencyCode).toBe(account.currencyCode);
      expect(result.spendingsByCurrency[0]!.amount).toBeCloseTo(100, 2);
      expect(result.topPayees).toHaveLength(1);
      expect(result.topPayees[0]).toMatchObject({ payeeId: payee.id, transactionsCount: 1 });
      expect(result.topPayees[0]!.amount).toBeCloseTo(100, 2);
    });
  });

  describe('Top payees', () => {
    it('returns the top 5 payees by expense, including the no-payee group when it ranks', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payees = await Promise.all(
        ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((name) =>
          helpers.createPayee({ payload: helpers.buildPayeePayload({ name: `stats-${name}` }), raw: true }),
        ),
      );

      const expenses: { amount: number; payeeId: RecordId | null }[] = [
        { amount: 350, payeeId: payees[0]!.id },
        { amount: 250, payeeId: payees[0]!.id },
        { amount: 500, payeeId: payees[1]!.id },
        { amount: 400, payeeId: payees[2]!.id },
        { amount: 300, payeeId: payees[3]!.id },
        { amount: 200, payeeId: payees[4]!.id },
        { amount: 100, payeeId: payees[5]!.id },
        { amount: 250, payeeId: null },
        { amount: 200, payeeId: null },
      ];

      const txIds: string[] = [];
      for (const { amount, payeeId } of expenses) {
        const [tx] = await helpers.createTransaction({
          raw: true,
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            payeeId,
            transactionType: TRANSACTION_TYPES.expense,
            time: '2025-10-10T10:00:00Z',
          }),
        });
        txIds.push(tx.id);
      }

      const tracker = await helpers.createTracker({
        name: 'payees-tracker',
        startDate: '2025-10-01T00:00:00Z',
        endDate: '2025-10-31T23:59:59Z',
        raw: true,
      });
      await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: txIds } });

      const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

      const noLogo = { logoDomain: null, logoInitials: null, logoColor: null, logoIcon: null, logoImageId: null };
      expect(result.topPayees).toEqual([
        { payeeId: payees[0]!.id, name: 'stats-P1', amount: 600, transactionsCount: 2, ...noLogo },
        { payeeId: payees[1]!.id, name: 'stats-P2', amount: 500, transactionsCount: 1, ...noLogo },
        { payeeId: null, name: null, amount: 450, transactionsCount: 2, ...noLogo },
        { payeeId: payees[2]!.id, name: 'stats-P3', amount: 400, transactionsCount: 1, ...noLogo },
        { payeeId: payees[3]!.id, name: 'stats-P4', amount: 300, transactionsCount: 1, ...noLogo },
      ]);
    });
  });

  describe('Error handling', () => {
    it('rejects unknown and malformed tracker ids', async () => {
      const notFound = await helpers.getTrackerSpendingStats({
        id: NONEXISTENT_ID,
        raw: false,
      });
      expect(notFound.statusCode).toBe(ERROR_CODES.NotFoundError);

      const invalid = await helpers.getTrackerSpendingStats({
        id: 'invalid' as unknown as string,
        raw: false,
      });
      expect(invalid.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
