import { Money, centsToApiDecimalOrNull } from '@common/types/money';
import { logger } from '@js/utils';
import BudgetCategories from '@models/budget-categories.model';
import BudgetTags from '@models/budget-tags.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { Op } from 'sequelize';

import type { BudgetRow } from '../types';
import { toDateOnly } from './utils';

export async function transformBudgets({ userId }: { userId: number }): Promise<BudgetRow[]> {
  // Don't catch baseCurrency errors: budgets are denominated against the
  // user's base currency, so a partial export emitting empty Currency cells
  // would silently lie about every budget row.
  const [budgets, baseCurrency] = await Promise.all([
    Budgets.findAll({ where: { userId }, order: [['name', 'ASC']] }),
    getBaseCurrency({ userId }),
  ]);

  if (budgets.length === 0) return [];

  const budgetIds = budgets.map((b) => b.id);
  const baseCurrencyCode = baseCurrency?.currencyCode ?? '';

  const [budgetCategoriesLinks, budgetTagsLinks, budgetTransactionLinks] = await Promise.all([
    BudgetCategories.findAll({ where: { budgetId: { [Op.in]: budgetIds } } }),
    BudgetTags.findAll({ where: { budgetId: { [Op.in]: budgetIds } } }),
    BudgetTransactions.findAll({ where: { budgetId: { [Op.in]: budgetIds } } }),
  ]);

  const categoryIds = [...new Set(budgetCategoriesLinks.map((l) => l.categoryId))];
  const tagIds = [...new Set(budgetTagsLinks.map((l) => l.tagId))];
  const transactionIds = [...new Set(budgetTransactionLinks.map((l) => l.transactionId))];

  // `userId` clauses defend against link tables that point at cross-user
  // categories/tags/transactions – the budget itself is user-scoped, but a
  // stray FK in the link table would otherwise leak another user's data.
  const [categories, tags, transactions] = await Promise.all([
    categoryIds.length
      ? Categories.findAll({ where: { userId, id: { [Op.in]: categoryIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Categories[]),
    tagIds.length
      ? Tags.findAll({ where: { userId, id: { [Op.in]: tagIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Tags[]),
    transactionIds.length
      ? // Export mirrors what the budget screen shows, and a budget counts every row
        // linked to it — so a linked plan is exported and summed like any other.
        findTransactions({
          where: { id: { [Op.in]: transactionIds } },
          planned: 'include',
          access: { creator: userId },
          balanceAdjustments: 'include',
          completeness: 'all',
        })
      : Promise.resolve([] as Transactions[]),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
  const txByBudgetId = new Map<string, Transactions[]>();
  const txById = new Map(transactions.map((t) => [t.id, t]));
  for (const link of budgetTransactionLinks) {
    const tx = txById.get(link.transactionId);
    if (!tx) {
      logger.warn(
        `Data export: budget ${link.budgetId} links to missing transaction ${link.transactionId}; spent total will be understated.`,
      );
      continue;
    }
    const list = txByBudgetId.get(link.budgetId) ?? [];
    list.push(tx);
    txByBudgetId.set(link.budgetId, list);
  }

  const categoriesByBudgetId = new Map<string, string[]>();
  for (const link of budgetCategoriesLinks) {
    const list = categoriesByBudgetId.get(link.budgetId) ?? [];
    const name = categoryNameById.get(link.categoryId);
    if (!name) {
      logger.warn(
        `Data export: budget ${link.budgetId} links to missing category ${link.categoryId}; emitting unresolved sentinel.`,
      );
      list.push(`(unresolved category)`);
    } else {
      list.push(name);
    }
    categoriesByBudgetId.set(link.budgetId, list);
  }

  const tagsByBudgetId = new Map<string, string[]>();
  for (const link of budgetTagsLinks) {
    const list = tagsByBudgetId.get(link.budgetId) ?? [];
    const name = tagNameById.get(link.tagId);
    if (!name) {
      logger.warn(
        `Data export: budget ${link.budgetId} links to missing tag ${link.tagId}; emitting unresolved sentinel.`,
      );
      list.push(`(unresolved tag)`);
    } else {
      list.push(name);
    }
    tagsByBudgetId.set(link.budgetId, list);
  }

  return budgets.map((budget): BudgetRow => {
    const linked = txByBudgetId.get(budget.id) ?? [];
    const spentAmount = Money.sum(linked.map((t) => t.refAmount.abs()));
    return {
      name: budget.name,
      status: budget.status,
      periodStart: budget.startDate ? toDateOnly({ value: budget.startDate }) : '',
      periodEnd: budget.endDate ? toDateOnly({ value: budget.endDate }) : '',
      limitAmount: centsToApiDecimalOrNull(budget.limitAmount),
      currency: baseCurrencyCode,
      categories: (categoriesByBudgetId.get(budget.id) ?? []).toSorted(),
      tags: (tagsByBudgetId.get(budget.id) ?? []).toSorted(),
      spentAmount: spentAmount.toNumber(),
    };
  });
}
