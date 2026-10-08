import { BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetCategories from '@models/budget-categories.model';
import BudgetTags from '@models/budget-tags.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { expandCategoryIds } from './utils/expand-category-ids';

interface CreateBudgetPayload {
  id?: string;
  userId: number;
  name: string;
  status: string;
  type?: BUDGET_TYPES;
  categoryIds?: string[];
  tagIds?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  autoInclude?: boolean;
  limitAmount?: Money | null;
}

const prepareTransactionFilters = (payload: CreateBudgetPayload) => ({
  userId: payload.userId,
  startDate: payload.startDate,
  endDate: payload.endDate,
  autoInclude: payload.autoInclude,
});

export const createBudget = withTransaction(async (payload: CreateBudgetPayload) => {
  const budgetType = payload.type ?? BUDGET_TYPES.manual;

  const budgetData: CreateBudgetPayload = {
    name: payload.name,
    userId: payload.userId,
    status: payload.status || BUDGET_STATUSES.active,
    type: budgetType,
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    autoInclude: payload.autoInclude ?? false,
    limitAmount: payload.limitAmount ?? null,
  };

  // Validate categoryIds exist before creating budget
  if (budgetType === BUDGET_TYPES.category && payload.categoryIds?.length) {
    const existingCategories = await Categories.findAll({
      where: {
        id: { [Op.in]: payload.categoryIds },
        userId: payload.userId,
      },
      attributes: ['id'],
      raw: true,
    });

    if (existingCategories.length !== payload.categoryIds.length) {
      throw new ValidationError({ message: t({ key: 'budgets.someCategoryIdsInvalid' }) });
    }
  }

  // Validate tagIds exist before creating budget
  if (budgetType === BUDGET_TYPES.tag && payload.tagIds?.length) {
    const existingTags = await Tags.findAll({
      where: {
        id: { [Op.in]: payload.tagIds },
        userId: payload.userId,
      },
      attributes: ['id'],
      raw: true,
    });

    if (existingTags.length !== payload.tagIds.length) {
      throw new ValidationError({ message: t({ key: 'budgets.someTagIdsInvalid' }) });
    }
  }

  const budget = await createBudgetModel(budgetData);

  // For category-based budgets, create BudgetCategories entries
  if (budgetType === BUDGET_TYPES.category && payload.categoryIds?.length) {
    // Expand parent categories to include children
    const expandedCategoryIds = await expandCategoryIds({
      userId: payload.userId,
      categoryIds: payload.categoryIds,
    });

    if (expandedCategoryIds.length) {
      await BudgetCategories.bulkCreate(
        expandedCategoryIds.map((categoryId) => ({
          budgetId: budget.id,
          categoryId,
        })),
      );
    }
  }

  // For tag-based budgets, create BudgetTags entries
  if (budgetType === BUDGET_TYPES.tag && payload.tagIds?.length) {
    await BudgetTags.bulkCreate(
      payload.tagIds.map((tagId) => ({
        budgetId: budget.id,
        tagId,
      })),
    );
  }

  // For manual budgets with autoInclude, link transactions by date range
  if (budgetType === BUDGET_TYPES.manual && payload.autoInclude && payload.startDate && payload.endDate) {
    const transactionFilters = prepareTransactionFilters(budgetData);
    const transactions = await findTransactions({
      planned: 'exclude',
      access: { creator: transactionFilters.userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        time: {
          [Op.between]: [transactionFilters.startDate, transactionFilters.endDate],
        },
      },
      attributes: ['id'],
    });

    if (transactions.length) {
      const transactionIds = transactions.map((tx) => tx.id);
      await BudgetTransactions.bulkCreate(
        transactionIds.map((transactionId) => ({
          budgetId: budget.id,
          transactionId,
        })),
      );
    }
  }

  // Reload budget with categories/tags for category- or tag-based budgets
  const reloadedBudget = await Budgets.findByPk(budget.id, {
    attributes: { exclude: ['userId'] },
    include:
      budgetType === BUDGET_TYPES.category
        ? [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color', 'parentId'] }]
        : budgetType === BUDGET_TYPES.tag
          ? [{ model: Tags, as: 'tags', attributes: ['id', 'name', 'color', 'icon'] }]
          : [],
  });

  return reloadedBudget!;
});

const createBudgetModel = async ({
  name,
  status,
  type,
  userId,
  startDate,
  endDate,
  autoInclude,
  limitAmount,
}: CreateBudgetPayload) => {
  const budgetData = {
    name,
    userId,
    status: status || BUDGET_STATUSES.active,
    type: type || BUDGET_TYPES.manual,
    startDate: startDate || null,
    endDate: endDate || null,
    autoInclude: autoInclude ?? false,
    limitAmount: limitAmount ?? null,
  };

  const budget = await Budgets.create(budgetData);
  return budget;
};
