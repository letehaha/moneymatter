import { BUDGET_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

import { getResponseInitialState } from './stats';

/**
 * E2E tests for Tag-Based Budgets
 *
 * These tests verify the complete flow of tag-based budgets including:
 * - Creation with tags
 * - Editing and tag assignment/unassignment
 * - Stats calculation based on transaction tags (OR-matched across linked tags)
 * - Spending-stats category/time breakdown
 * - Edge cases
 */
describe('Tag-Based Budgets', () => {
  describe('Budget Creation', () => {
    it('successfully creates a tag budget with a single tag', async () => {
      const tag = await helpers.createTag({
        payload: helpers.buildTagPayload({ name: 'Fixed' }),
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'Fixed Expenses Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        limitAmount: 500,
        raw: true,
      });

      expect(budget.type).toBe(BUDGET_TYPES.tag);
      expect(budget.tags).toHaveLength(1);
      expect(budget.tags![0]!.id).toBe(tag.id);
      expect(budget.limitAmount).toBe(500);
    });

    it('successfully creates a tag budget with multiple tags', async () => {
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Fixed' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Subscriptions' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Recurring Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id, tag2.id],
        limitAmount: 1000,
        raw: true,
      });

      expect(budget.type).toBe(BUDGET_TYPES.tag);
      expect(budget.tags).toHaveLength(2);
      const tagIds = budget.tags!.map((t) => t.id);
      expect(tagIds).toContain(tag1.id);
      expect(tagIds).toContain(tag2.id);
    });

    it('fails to create a tag budget with an empty or unknown tag list', async () => {
      const withoutTags = await helpers.createCustomBudget({
        name: 'Invalid Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [],
        raw: false,
      });

      expect(withoutTags.statusCode).toBe(ERROR_CODES.ValidationError);

      const withUnknownTag = await helpers.createCustomBudget({
        name: 'Invalid Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [NONEXISTENT_ID],
        raw: false,
      });

      expect(withUnknownTag.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('Budget Editing', () => {
    it('successfully updates tag budget tags', async () => {
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag1' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag2' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id],
        raw: true,
      });

      expect(budget.tags).toHaveLength(1);

      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { tagIds: [tag1.id, tag2.id] },
        raw: true,
      });

      expect(updatedBudget.tags).toHaveLength(2);
    });

    it('successfully removes tags from budget', async () => {
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag1' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag2' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id, tag2.id],
        raw: true,
      });

      expect(budget.tags).toHaveLength(2);

      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { tagIds: [tag1.id] },
        raw: true,
      });

      expect(updatedBudget.tags).toHaveLength(1);
      expect(updatedBudget.tags![0]!.id).toBe(tag1.id);
    });

    it('successfully updates budget name without affecting tags', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag1' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Original Name',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { name: 'New Name' },
        raw: true,
      });

      expect(updatedBudget.name).toBe('New Name');
      expect(updatedBudget.tags).toHaveLength(1);
      expect(updatedBudget.tags![0]!.id).toBe(tag.id);
    });
  });

  describe('Stats Calculation', () => {
    it('correctly calculates stats for transactions matching the tag', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Fixed' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Fixed Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        limitAmount: 500,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [tx1.id, tx2.id] });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualExpense).toBe(150);
      expect(stats!.summary.actualIncome).toBe(0);
      expect(stats!.summary.balance).toBe(-150);
      expect(stats!.summary.utilizationRate).toBeCloseTo((150 / 500) * 100, 1);
      expect(stats!.summary.transactionsCount).toBe(2);
    });

    it('does not count transactions without a matching tag', async () => {
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Fixed' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Variable' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Fixed Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id],
        limitAmount: 500,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const [taggedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const [otherTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.addTransactionsToTag({ tagId: tag1.id, transactionIds: [taggedTx.id] });
      await helpers.addTransactionsToTag({ tagId: tag2.id, transactionIds: [otherTx.id] });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('OR-matches across multiple linked tags without double-counting', async () => {
      // Names must avoid the per-user seeded default tags ('Want', 'Need', 'Must') to avoid
      // a uniqueness collision (every test user gets those three seeded automatically).
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Discretionary' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Fixed' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Want or Fixed Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id, tag2.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Only tag1
      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      // Only tag2
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      // Both tags - must count once, not twice
      const [tx3] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 70,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      // Neither tag
      const [tx4] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 999,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      void tx4;

      await helpers.addTransactionsToTag({ tagId: tag1.id, transactionIds: [tx1.id, tx3.id] });
      await helpers.addTransactionsToTag({ tagId: tag2.id, transactionIds: [tx2.id, tx3.id] });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualExpense).toBe(150);
      expect(stats!.summary.transactionsCount).toBe(3);
    });

    it('counts both income and expense transactions', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Freelance' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Freelance Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const [incomeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [incomeTx.id, expenseTx.id] });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualIncome).toBe(500);
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.balance).toBe(400);
      expect(stats!.summary.transactionsCount).toBe(2);
    });

    it('applies budget date windows when calculating stats', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Test' }), raw: true });
      const account = await helpers.createAccount({ raw: true });

      const seedTimes: [number, string][] = [
        [100, '2025-02-15T12:00:00Z'],
        [300, '2025-03-01T00:00:00Z'],
        [400, '2025-03-15T12:00:00Z'],
        [500, '2025-03-31T23:59:59Z'],
        [600, '2025-04-15T12:00:00Z'],
      ];

      const txIds: string[] = [];
      for (const [amount, time] of seedTimes) {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            time,
          }),
          raw: true,
        });
        txIds.push(tx.id);
      }
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: txIds });

      const rangeBudget = await helpers.createCustomBudget({
        name: 'March Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      // Both boundaries are inclusive: the 2025-03-01T00:00:00Z and 2025-03-31T23:59:59Z rows count.
      const rangeStats = await helpers.getStats({ id: rangeBudget.id, raw: true });
      expect(rangeStats!.summary.actualExpense).toBe(1200);
      expect(rangeStats!.summary.transactionsCount).toBe(3);
    }, 60_000);
  });

  describe('Spending Stats', () => {
    it('breaks down tagged spending by category', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Fixed' }), raw: true });
      const category1 = await helpers.addCustomCategory({ name: 'Housing', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Software', color: '#00FF00', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Fixed Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const [rentTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
        }),
        raw: true,
      });
      const [subscriptionTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 20,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category2.id,
        }),
        raw: true,
      });

      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [rentTx.id, subscriptionTx.id] });

      const spendingStats = await helpers.getSpendingStats({ id: budget.id, raw: true });

      expect(spendingStats.spendingsByCategory).toHaveLength(2);
      const housing = spendingStats.spendingsByCategory.find((c) => c.categoryId === category1.id);
      const software = spendingStats.spendingsByCategory.find((c) => c.categoryId === category2.id);
      expect(housing!.amount).toBe(1000);
      expect(software!.amount).toBe(20);
    });

    it('returns an empty response for a tag budget with no matching transactions', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Unused' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Unused Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      const spendingStats = await helpers.getSpendingStats({ id: budget.id, raw: true });

      expect(spendingStats.spendingsByCategory).toHaveLength(0);
      expect(spendingStats.spendingOverTime.periods).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('returns empty stats for tag budget with no matching transactions', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Empty' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Empty Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats).toEqual(getResponseInitialState());
    });

    it('handles tag deletion gracefully', async () => {
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag1' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag2' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag1.id, tag2.id],
        raw: true,
      });

      expect(budget.tags).toHaveLength(2);

      await helpers.deleteTag({ id: tag1.id, raw: true });

      const updatedBudget = await helpers.getCustomBudgetById({ id: budget.id, raw: true });

      expect(updatedBudget!.tags).toHaveLength(1);
      expect(updatedBudget!.tags![0]!.id).toBe(tag2.id);
    });

    it('handles budget with all tags removed via deletion (empty stats, not an error)', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'OnlyTag' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      await helpers.deleteTag({ id: tag.id, raw: true });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats).toEqual(getResponseInitialState());
    });

    it('handles multiple budgets tracking the same tag', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Shared' }), raw: true });

      const budget1 = await helpers.createCustomBudget({
        name: 'Budget 1',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        limitAmount: 500,
        raw: true,
      });
      const budget2 = await helpers.createCustomBudget({
        name: 'Budget 2',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        limitAmount: 1000,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [tx.id] });

      const stats1 = await helpers.getStats({ id: budget1.id, raw: true });
      const stats2 = await helpers.getStats({ id: budget2.id, raw: true });

      expect(stats1!.summary.actualExpense).toBe(100);
      expect(stats2!.summary.actualExpense).toBe(100);
      expect(stats1!.summary.utilizationRate).toBeCloseTo((100 / 500) * 100, 1);
      expect(stats2!.summary.utilizationRate).toBeCloseTo((100 / 1000) * 100, 1);
    });

    it('handles budget deletion', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'ToDelete' }), raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'To Delete',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      await helpers.deleteCustomBudget({ id: budget.id, raw: true });

      const response = await helpers.getCustomBudgetById({ id: budget.id, raw: false });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Listing and Filtering', () => {
    it('returns budgets with tags populated', async () => {
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Test' }), raw: true });

      await helpers.createCustomBudget({
        name: 'Tag Budget',
        type: BUDGET_TYPES.tag,
        tagIds: [tag.id],
        raw: true,
      });

      await helpers.createCustomBudget({
        name: 'Manual Budget',
        type: BUDGET_TYPES.manual,
        raw: true,
      });

      const budgets = await helpers.getCustomBudgets({ raw: true });

      const tagBudget = budgets.find((b) => b.name === 'Tag Budget');
      const manualBudget = budgets.find((b) => b.name === 'Manual Budget');

      expect(tagBudget!.type).toBe(BUDGET_TYPES.tag);
      expect(tagBudget!.tags).toHaveLength(1);
      expect(tagBudget!.tags![0]!.id).toBe(tag.id);

      expect(manualBudget!.type).toBe(BUDGET_TYPES.manual);
      expect(manualBudget!.tags).toHaveLength(0);
    });
  });
});
