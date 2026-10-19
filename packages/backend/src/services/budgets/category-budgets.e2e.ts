import { BUDGET_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

import { getResponseInitialState } from './stats';

/**
 * E2E tests for Category-Based Budgets
 *
 * These tests verify the complete flow of category-based budgets including:
 * - Creation with categories
 * - Editing and category assignment/unassignment
 * - Stats calculation based on transaction categories
 * - Split transaction handling
 * - Edge cases
 */
describe('Category-Based Budgets', () => {
  describe('Budget Creation', () => {
    it('successfully creates a category budget with single category', async () => {
      // Create a category
      const category = await helpers.addCustomCategory({
        name: 'Food',
        color: '#FF0000',
        raw: true,
      });

      // Create category budget
      const budget = await helpers.createCustomBudget({
        name: 'Food Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        limitAmount: 500,
        raw: true,
      });

      expect(budget.type).toBe(BUDGET_TYPES.category);
      expect(budget.categories).toHaveLength(1);
      expect(budget.categories![0]!.id).toBe(category.id);
      expect(budget.limitAmount).toBe(500);
    });

    it('successfully creates a category budget with multiple categories', async () => {
      const category1 = await helpers.addCustomCategory({
        name: 'Restaurants',
        color: '#FF0000',
        raw: true,
      });
      const category2 = await helpers.addCustomCategory({
        name: 'Cafes',
        color: '#00FF00',
        raw: true,
      });
      const category3 = await helpers.addCustomCategory({
        name: 'Bars',
        color: '#0000FF',
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'Eating Out Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id, category3.id],
        limitAmount: 1000,
        raw: true,
      });

      expect(budget.type).toBe(BUDGET_TYPES.category);
      expect(budget.categories).toHaveLength(3);
      const categoryIds = budget.categories.map((c) => c.id);
      expect(categoryIds).toContain(category1.id);
      expect(categoryIds).toContain(category2.id);
      expect(categoryIds).toContain(category3.id);
    });

    it('successfully creates a category budget with parent category (auto-includes children)', async () => {
      // Create parent category
      const parentCategory = await helpers.addCustomCategory({
        name: 'Entertainment',
        color: '#FF0000',
        raw: true,
      });

      // Create child categories
      const child1 = await helpers.addCustomCategory({
        name: 'Movies',
        color: '#00FF00',
        parentId: parentCategory.id,
        raw: true,
      });
      const child2 = await helpers.addCustomCategory({
        name: 'Games',
        color: '#0000FF',
        parentId: parentCategory.id,
        raw: true,
      });

      // Create budget with parent only - children should be auto-included
      const budget = await helpers.createCustomBudget({
        name: 'Entertainment Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [parentCategory.id],
        raw: true,
      });

      expect(budget.type).toBe(BUDGET_TYPES.category);
      // Should have parent + 2 children
      expect(budget.categories).toHaveLength(3);
      const categoryIds = budget.categories.map((c) => c.id);
      expect(categoryIds).toContain(parentCategory.id);
      expect(categoryIds).toContain(child1.id);
      expect(categoryIds).toContain(child2.id);
    });

    it('fails to create a category budget with an empty or unknown category list', async () => {
      const withoutCategories = await helpers.createCustomBudget({
        name: 'Invalid Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [],
        raw: false,
      });

      expect(withoutCategories.statusCode).toBe(ERROR_CODES.ValidationError);

      const withUnknownCategory = await helpers.createCustomBudget({
        name: 'Invalid Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [NONEXISTENT_ID],
        raw: false,
      });

      expect(withUnknownCategory.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('creates a manual budget with the type omitted or passed explicitly', async () => {
      const defaultTypeBudget = await helpers.createCustomBudget({
        name: 'Manual Budget',
        limitAmount: 1000,
        raw: true,
      });

      expect(defaultTypeBudget.type).toBe(BUDGET_TYPES.manual);
      expect(defaultTypeBudget.categories).toHaveLength(0);

      const explicitTypeBudget = await helpers.createCustomBudget({
        name: 'Manual Budget Explicit',
        type: BUDGET_TYPES.manual,
        limitAmount: 1000,
        raw: true,
      });

      expect(explicitTypeBudget.type).toBe(BUDGET_TYPES.manual);
      expect(explicitTypeBudget.categories).toHaveLength(0);
    }, 60_000);
  });

  describe('Budget Editing', () => {
    it('successfully updates category budget categories', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Cat1', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Cat2', color: '#00FF00', raw: true });

      // Create budget with one category
      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        raw: true,
      });

      expect(budget.categories).toHaveLength(1);

      // Update to include both categories
      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { categoryIds: [category1.id, category2.id] },
        raw: true,
      });

      expect(updatedBudget.categories).toHaveLength(2);
    });

    it('successfully removes categories from budget', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Cat1', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Cat2', color: '#00FF00', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id],
        raw: true,
      });

      expect(budget.categories).toHaveLength(2);

      // Remove one category
      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { categoryIds: [category1.id] },
        raw: true,
      });

      expect(updatedBudget.categories).toHaveLength(1);
      expect(updatedBudget.categories![0]!.id).toBe(category1.id);
    });

    it('successfully updates budget name without affecting categories', async () => {
      const category = await helpers.addCustomCategory({ name: 'Cat1', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Original Name',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const updatedBudget = await helpers.editCustomBudget({
        id: budget.id,
        params: { name: 'New Name' },
        raw: true,
      });

      expect(updatedBudget.name).toBe('New Name');
      expect(updatedBudget.categories).toHaveLength(1);
      expect(updatedBudget.categories![0]!.id).toBe(category.id);
    });

    it('rejects an empty or foreign category list and keeps categories and lines', async () => {
      const category = await helpers.addCustomCategory({ name: 'Cat1', color: '#FF0000', raw: true });
      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });
      const line = await helpers.createTrackerLine({
        budgetId: budget.id,
        payload: { name: 'Line', categoryIds: [category.id] },
        raw: true,
      });
      const stranger = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignCategory = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.addCustomCategory({ name: 'Foreign', color: '#00FF00', raw: true }),
      });

      for (const categoryIds of [[], [foreignCategory.id]]) {
        const response = await helpers.editCustomBudget({ id: budget.id, params: { categoryIds }, raw: false });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      const fetched = (await helpers.getCustomBudgetById({ id: budget.id, raw: true }))!;
      expect(fetched.categories!.map((c) => c.id)).toEqual([category.id]);
      expect(fetched.lines!.map((l) => l.id)).toEqual([line.id]);
    });
  });

  describe('Stats Calculation - Basic', () => {
    it('correctly calculates stats for transactions matching category', async () => {
      const category = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });

      // Create category budget
      const budget = await helpers.createCustomBudget({
        name: 'Grocery Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        limitAmount: 500,
        raw: true,
      });

      // Create expense transaction with matching category
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      // Create another expense
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualExpense).toBe(150);
      expect(stats!.summary.actualIncome).toBe(0);
      expect(stats!.summary.balance).toBe(-150);
      expect(stats!.summary.utilizationRate).toBeCloseTo((150 / 500) * 100, 1);
      expect(stats!.summary.transactionsCount).toBe(2);
    });

    it('does not count transactions with non-matching categories', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Transport', color: '#00FF00', raw: true });

      // Budget only tracks category1
      const budget = await helpers.createCustomBudget({
        name: 'Grocery Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        limitAmount: 500,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Transaction with matching category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
        }),
        raw: true,
      });

      // Transaction with non-matching category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category2.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      // Should only count the transaction with category1
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('counts both income and expense transactions', async () => {
      const category = await helpers.addCustomCategory({ name: 'Freelance', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Freelance Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Income transaction
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category.id,
        }),
        raw: true,
      });

      // Expense transaction
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.summary.actualIncome).toBe(500);
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.balance).toBe(400);
      expect(stats!.summary.transactionsCount).toBe(2);
    });

    it('tracks transactions with child categories when parent is in budget', async () => {
      const parentCategory = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });
      const childCategory = await helpers.addCustomCategory({
        name: 'Restaurants',
        color: '#00FF00',
        parentId: parentCategory.id,
        raw: true,
      });

      // Budget includes parent (which auto-includes children)
      const budget = await helpers.createCustomBudget({
        name: 'Food Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [parentCategory.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Transaction with child category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: childCategory.id,
        }),
        raw: true,
      });

      // Transaction with parent category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: parentCategory.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      // Should count both parent and child category transactions
      expect(stats!.summary.actualExpense).toBe(80);
      expect(stats!.summary.transactionsCount).toBe(2);
    });
  });

  describe('Stats Calculation - Split Transactions', () => {
    it('counts only splits whose category the budget tracks', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Transport', color: '#00FF00', raw: true });
      const category3 = await helpers.addCustomCategory({ name: 'Entertainment', color: '#0000FF', raw: true });

      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
          splits: [
            { amount: 50, categoryId: category1.id },
            { amount: 30, categoryId: category2.id },
            { amount: 70, categoryId: category3.id },
          ],
        }),
        raw: true,
      });

      const oneCategoryBudget = await helpers.createCustomBudget({
        name: 'Food Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        limitAmount: 500,
        raw: true,
      });
      const twoCategoryBudget = await helpers.createCustomBudget({
        name: 'Essential Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id],
        raw: true,
      });
      const allCategoryBudget = await helpers.createCustomBudget({
        name: 'Everything Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id, category3.id],
        raw: true,
      });

      const oneCategoryStats = await helpers.getStats({
        id: oneCategoryBudget.id,
        raw: true,
      });
      expect(oneCategoryStats!.summary.actualExpense).toBe(50);
      expect(oneCategoryStats!.summary.transactionsCount).toBe(1);

      const twoCategoryStats = await helpers.getStats({
        id: twoCategoryBudget.id,
        raw: true,
      });
      expect(twoCategoryStats!.summary.actualExpense).toBe(80);
      expect(twoCategoryStats!.summary.transactionsCount).toBe(1);

      const allCategoryStats = await helpers.getStats({
        id: allCategoryBudget.id,
        raw: true,
      });
      expect(allCategoryStats!.summary.actualExpense).toBe(150);
      expect(allCategoryStats!.summary.transactionsCount).toBe(1);
    }, 60_000);
  });

  describe('Stats Calculation - Date Windows', () => {
    it('applies budget date windows when calculating stats', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });
      const account = await helpers.createAccount({ raw: true });

      const seedTimes: [number, string][] = [
        [100, '2025-01-15T12:00:00Z'],
        [200, '2025-02-15T12:00:00Z'],
        [300, '2025-03-01T00:00:00Z'],
        [400, '2025-03-15T12:00:00Z'],
        [500, '2025-03-31T23:59:59Z'],
        [600, '2025-04-15T12:00:00Z'],
        [700, '2025-06-15T12:00:00Z'],
      ];

      for (const [amount, time] of seedTimes) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: category.id,
            time,
          }),
          raw: true,
        });
      }

      const rangeBudget = await helpers.createCustomBudget({
        name: 'March Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });
      const startOnlyBudget = await helpers.createCustomBudget({
        name: 'Start Only Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: null,
        raw: true,
      });
      const endOnlyBudget = await helpers.createCustomBudget({
        name: 'End Only Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: null,
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });
      const openBudget = await helpers.createCustomBudget({
        name: 'Open Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      // Both boundaries are inclusive: the 2025-03-01T00:00:00Z and 2025-03-31T23:59:59Z rows count.
      const rangeStats = await helpers.getStats({
        id: rangeBudget.id,
        raw: true,
      });
      expect(rangeStats!.summary.actualExpense).toBe(1200);
      expect(rangeStats!.summary.transactionsCount).toBe(3);

      const startOnlyStats = await helpers.getStats({
        id: startOnlyBudget.id,
        raw: true,
      });
      expect(startOnlyStats!.summary.actualExpense).toBe(2500);
      expect(startOnlyStats!.summary.transactionsCount).toBe(5);

      const endOnlyStats = await helpers.getStats({
        id: endOnlyBudget.id,
        raw: true,
      });
      expect(endOnlyStats!.summary.actualExpense).toBe(1500);
      expect(endOnlyStats!.summary.transactionsCount).toBe(5);

      const openStats = await helpers.getStats({
        id: openBudget.id,
        raw: true,
      });
      expect(openStats!.summary.actualExpense).toBe(2800);
      expect(openStats!.summary.transactionsCount).toBe(7);
    }, 60_000);
  });

  describe('Category Budget vs Manual Budget Stats', () => {
    it('manual budget does not auto-track transactions by category', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      // Create manual budget
      const budget = await helpers.createCustomBudget({
        name: 'Manual Budget',
        type: BUDGET_TYPES.manual,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Create transaction with category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      // Manual budget should NOT auto-count transactions by category
      expect(stats).toEqual(getResponseInitialState());
    });

    it('manual budget counts manually linked transactions', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      // Create manual budget
      const budget = await helpers.createCustomBudget({
        name: 'Manual Budget',
        type: BUDGET_TYPES.manual,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Create transaction
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      // Manually link transaction to budget
      await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [tx.id] },
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      // Should now count the manually linked transaction
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('category budget cannot have transactions manually linked', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      // Create category budget
      const budget = await helpers.createCustomBudget({
        name: 'Category Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
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

      // Try to manually link transaction to category budget - should fail or be ignored
      const response = await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [tx.id] },
        raw: false,
      });

      // Category budgets should reject manual transaction linking
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('Edge Cases', () => {
    it('returns empty stats for category budget with no matching transactions', async () => {
      const category = await helpers.addCustomCategory({ name: 'Empty', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Empty Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats).toEqual(getResponseInitialState());
    });

    it('handles category deletion gracefully', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Cat1', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Cat2', color: '#00FF00', raw: true });

      // Create budget with both categories
      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id],
        raw: true,
      });

      expect(budget.categories).toHaveLength(2);

      // Delete one category
      await helpers.deleteCustomCategory({ categoryId: category1.id, raw: true });

      // Fetch budget again
      const updatedBudget = await helpers.getCustomBudgetById({ id: budget.id, raw: true });

      // Should only have one category now
      expect(updatedBudget!.categories).toHaveLength(1);
      expect(updatedBudget!.categories![0]!.id).toBe(category2.id);
    });

    it('handles multiple budgets tracking same category', async () => {
      const category = await helpers.addCustomCategory({ name: 'Shared', color: '#FF0000', raw: true });

      // Create two budgets tracking the same category
      const budget1 = await helpers.createCustomBudget({
        name: 'Budget 1',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        limitAmount: 500,
        raw: true,
      });

      const budget2 = await helpers.createCustomBudget({
        name: 'Budget 2',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        limitAmount: 1000,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      // Both budgets should count the same transaction
      const stats1 = await helpers.getStats({ id: budget1.id, raw: true });
      const stats2 = await helpers.getStats({ id: budget2.id, raw: true });

      expect(stats1!.summary.actualExpense).toBe(100);
      expect(stats2!.summary.actualExpense).toBe(100);

      // But utilization rates should differ based on limits
      expect(stats1!.summary.utilizationRate).toBeCloseTo((100 / 500) * 100, 1);
      expect(stats2!.summary.utilizationRate).toBeCloseTo((100 / 1000) * 100, 1);
    });

    it('handles overlapping categories in budget (no double counting)', async () => {
      const parentCategory = await helpers.addCustomCategory({ name: 'Parent', color: '#FF0000', raw: true });
      const childCategory = await helpers.addCustomCategory({
        name: 'Child',
        color: '#00FF00',
        parentId: parentCategory.id,
        raw: true,
      });

      // Budget explicitly includes both parent and child
      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [parentCategory.id, childCategory.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Transaction with child category
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: childCategory.id,
        }),
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      // Should NOT double-count the transaction
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('handles transaction deletion', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      // Verify transaction is counted
      let stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(100);

      // Delete transaction
      await helpers.deleteTransaction({ id: tx.id });

      // Verify transaction is no longer counted
      stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(0);
    });

    it('handles budget deletion', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'To Delete',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      // Delete budget
      await helpers.deleteCustomBudget({ id: budget.id, raw: true });

      // Verify budget no longer exists
      const response = await helpers.getCustomBudgetById({ id: budget.id, raw: false });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Listing and Filtering', () => {
    it('returns budgets with categories populated', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      await helpers.createCustomBudget({
        name: 'Category Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      await helpers.createCustomBudget({
        name: 'Manual Budget',
        type: BUDGET_TYPES.manual,
        raw: true,
      });

      const budgets = await helpers.getCustomBudgets({ raw: true });

      expect(budgets.length).toBe(2);

      const categoryBudget = budgets.find((b) => b.name === 'Category Budget');
      const manualBudget = budgets.find((b) => b.name === 'Manual Budget');

      expect(categoryBudget!.type).toBe(BUDGET_TYPES.category);
      expect(categoryBudget!.categories).toHaveLength(1);
      expect(categoryBudget!.categories![0]!.id).toBe(category.id);

      expect(manualBudget!.type).toBe(BUDGET_TYPES.manual);
      expect(manualBudget!.categories).toHaveLength(0);
    });
  });

  describe('Get Category Budget Transactions Endpoint', () => {
    it('returns transactions matching budget categories', async () => {
      const category = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Food Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Create matching transaction
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });

      const result = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });

      expect(result.total).toBe(1);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.effectiveCategory?.id).toBe(category.id);
      expect(result.transactions[0]!.effectiveCategory?.name).toBe('Food');
    });

    it('excludes transactions not matching budget categories', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Transport', color: '#00FF00', raw: true });

      // Budget only tracks Food
      const budget = await helpers.createCustomBudget({
        name: 'Food Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Matching transaction
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
        }),
        raw: true,
      });

      // Non-matching transaction
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category2.id,
        }),
        raw: true,
      });

      const result = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });

      expect(result.total).toBe(1);
      expect(result.transactions[0]!.effectiveCategory?.id).toBe(category1.id);
    });

    it('returns one entry per matching split', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Household', color: '#00FF00', raw: true });
      const category3 = await helpers.addCustomCategory({
        name: 'Leisure',
        color: '#0000FF',
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
          splits: [
            { amount: 50, categoryId: category1.id },
            { amount: 30, categoryId: category2.id },
            { amount: 70, categoryId: category3.id },
          ],
        }),
        raw: true,
      });

      const oneCategoryBudget = await helpers.createCustomBudget({
        name: 'Grocery Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        raw: true,
      });
      const twoCategoryBudget = await helpers.createCustomBudget({
        name: 'Shopping Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id, category2.id],
        raw: true,
      });

      const oneCategoryResult = await helpers.getCategoryBudgetTransactions({
        id: oneCategoryBudget.id,
        raw: true,
      });
      expect(oneCategoryResult.total).toBe(1);
      expect(oneCategoryResult.transactions[0]!.effectiveCategory?.id).toBe(category1.id);
      expect(oneCategoryResult.transactions[0]!.effectiveRefAmount).toBe(50);

      const twoCategoryResult = await helpers.getCategoryBudgetTransactions({
        id: twoCategoryBudget.id,
        raw: true,
      });
      expect(twoCategoryResult.total).toBe(2);
      const amounts = twoCategoryResult.transactions.map((t) => t.effectiveRefAmount);
      expect(amounts).toContain(50);
      expect(amounts).toContain(30);
    }, 60_000);

    it('supports pagination with from and limit', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Create 5 transactions
      for (let i = 1; i <= 5; i++) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: i * 10,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: category.id,
            time: `2025-03-0${i}T12:00:00Z`,
          }),
          raw: true,
        });
      }

      // Get first page
      const page1 = await helpers.getCategoryBudgetTransactions({ id: budget.id, from: 0, limit: 2, raw: true });
      expect(page1.total).toBe(5);
      expect(page1.transactions).toHaveLength(2);

      // Get second page
      const page2 = await helpers.getCategoryBudgetTransactions({ id: budget.id, from: 2, limit: 2, raw: true });
      expect(page2.total).toBe(5);
      expect(page2.transactions).toHaveLength(2);

      // Get last page
      const page3 = await helpers.getCategoryBudgetTransactions({ id: budget.id, from: 4, limit: 2, raw: true });
      expect(page3.total).toBe(5);
      expect(page3.transactions).toHaveLength(1);
    });

    it('returns empty array for budget with no matching transactions', async () => {
      const category = await helpers.addCustomCategory({ name: 'Empty', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Empty Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const result = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });

      expect(result.total).toBe(0);
      expect(result.transactions).toHaveLength(0);
    });

    it('rejects a manual budget id and an unknown budget id', async () => {
      const manualBudget = await helpers.createCustomBudget({
        name: 'Manual Budget',
        type: BUDGET_TYPES.manual,
        raw: true,
      });

      const manualResponse = await helpers.getCategoryBudgetTransactions({
        id: manualBudget.id,
        raw: false,
      });
      expect(manualResponse.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownResponse = await helpers.getCategoryBudgetTransactions({
        id: NONEXISTENT_ID,
        raw: false,
      });
      expect(unknownResponse.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('returns transactions sorted by date descending', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Create transactions in non-chronological order
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
          time: '2025-03-01T12:00:00Z',
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
          time: '2025-03-15T12:00:00Z',
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
          time: '2025-03-10T12:00:00Z',
        }),
        raw: true,
      });

      const result = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });

      expect(result.transactions).toHaveLength(3);
      // Should be sorted DESC: 300 (Mar 15), 200 (Mar 10), 100 (Mar 1)
      expect(result.transactions[0]!.effectiveRefAmount).toBe(300);
      expect(result.transactions[1]!.effectiveRefAmount).toBe(200);
      expect(result.transactions[2]!.effectiveRefAmount).toBe(100);
    });

    it('applies budget date windows to the transactions endpoint', async () => {
      const category = await helpers.addCustomCategory({ name: 'Test', color: '#FF0000', raw: true });
      const account = await helpers.createAccount({ raw: true });

      const seedTimes: [number, string][] = [
        [100, '2025-01-15T12:00:00Z'],
        [200, '2025-02-15T12:00:00Z'],
        [300, '2025-03-01T00:00:00Z'],
        [400, '2025-03-15T12:00:00Z'],
        [500, '2025-03-31T23:59:59Z'],
        [600, '2025-04-15T12:00:00Z'],
        [700, '2025-06-15T12:00:00Z'],
      ];

      for (const [amount, time] of seedTimes) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: category.id,
            time,
          }),
          raw: true,
        });
      }

      const rangeBudget = await helpers.createCustomBudget({
        name: 'March Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });
      const startOnlyBudget = await helpers.createCustomBudget({
        name: 'Start Only Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: null,
        raw: true,
      });
      const endOnlyBudget = await helpers.createCustomBudget({
        name: 'End Only Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        startDate: null,
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      const rangeResult = await helpers.getCategoryBudgetTransactions({
        id: rangeBudget.id,
        raw: true,
      });
      expect(rangeResult.total).toBe(3);
      expect(rangeResult.transactions.map((t) => t.effectiveRefAmount).toSorted()).toEqual([300, 400, 500]);

      const startOnlyResult = await helpers.getCategoryBudgetTransactions({
        id: startOnlyBudget.id,
        raw: true,
      });
      expect(startOnlyResult.total).toBe(5);
      expect(startOnlyResult.transactions.map((t) => t.effectiveRefAmount).toSorted()).toEqual([
        300, 400, 500, 600, 700,
      ]);

      const endOnlyResult = await helpers.getCategoryBudgetTransactions({
        id: endOnlyBudget.id,
        raw: true,
      });
      expect(endOnlyResult.total).toBe(5);
      expect(endOnlyResult.transactions.map((t) => t.effectiveRefAmount).toSorted()).toEqual([100, 200, 300, 400, 500]);
    }, 60_000);
  });

  describe('AI Categorization Simulation', () => {
    /**
     * These tests simulate what happens after AI categorization assigns a category
     * to a transaction. Since AI categorization is an async background process,
     * we simulate its effect by creating transactions without a category and then
     * updating them to have a category (which is what AI categorization does).
     */

    it('counts a batch of transactions once AI categorization assigns the budget category', async () => {
      const category = await helpers.addCustomCategory({
        name: 'AI Target Category',
        color: '#FF0000',
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'AI Tracked Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        limitAmount: 1000,
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      const transactions = await Promise.all(
        [30, 45, 25].map((amount) =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount,
              transactionType: TRANSACTION_TYPES.expense,
            }),
            raw: true,
          }),
        ),
      );

      let stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(0);
      expect(stats!.summary.transactionsCount).toBe(0);

      await Promise.all(
        transactions.map(([tx]) =>
          helpers.updateTransaction({
            id: tx.id,
            payload: { categoryId: category.id },
            raw: true,
          }),
        ),
      );

      stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(3);
      expect(stats!.summary.utilizationRate).toBeCloseTo((100 / 1000) * 100, 1);
    }, 60_000);

    it('handles AI re-categorization (category changed by AI)', async () => {
      const category1 = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Restaurants', color: '#00FF00', raw: true });

      // Budget for Groceries
      const groceryBudget = await helpers.createCustomBudget({
        name: 'Grocery Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category1.id],
        raw: true,
      });

      // Budget for Restaurants
      const restaurantBudget = await helpers.createCustomBudget({
        name: 'Restaurant Budget',
        type: BUDGET_TYPES.category,
        categoryIds: [category2.id],
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });

      // Transaction initially categorized as Groceries by first AI pass
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category1.id,
        }),
        raw: true,
      });

      // Verify counts in both budgets
      let groceryStats = await helpers.getStats({ id: groceryBudget.id, raw: true });
      let restaurantStats = await helpers.getStats({ id: restaurantBudget.id, raw: true });

      expect(groceryStats!.summary.actualExpense).toBe(50);
      expect(restaurantStats!.summary.actualExpense).toBe(0);

      // Simulate: User corrects or AI re-categorizes to Restaurants
      await helpers.updateTransaction({
        id: tx.id,
        payload: { categoryId: category2.id },
        raw: true,
      });

      // Verify counts updated correctly
      groceryStats = await helpers.getStats({ id: groceryBudget.id, raw: true });
      restaurantStats = await helpers.getStats({ id: restaurantBudget.id, raw: true });

      expect(groceryStats!.summary.actualExpense).toBe(0);
      expect(restaurantStats!.summary.actualExpense).toBe(50);
    });
  });
});
