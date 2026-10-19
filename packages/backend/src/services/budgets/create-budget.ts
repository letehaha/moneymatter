import {
  AI_FEATURE,
  AI_FEATURE_ENTITLEMENTS,
  BUDGET_STATUSES,
  BUDGET_TYPES,
  type EntityLogoWritePayload,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import BudgetCategories from '@models/budget-categories.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import { findTransactions } from '@models/transactions-query';
import { applyLogoWrite } from '@services/brand-logos';
import { includeCategories } from '@services/budget.service';
import { runAfterCommit } from '@services/common/run-after-commit';
import { withTransaction } from '@services/common/with-transaction';
import { startFeatureTrial } from '@services/entitlements/start-feature-trial.service';
import { Op } from 'sequelize';

import { assertSmartTrackingConfig } from './smart-tracking/assert-smart-tracking-config';
import { enqueueTrackerScan } from './smart-tracking/tracker-scan-queue';
import { assertCategoriesOwnedByUser } from './utils/assert-categories-owned-by-user';
import { expandCategoryIds } from './utils/expand-category-ids';

interface CreateBudgetPayload extends EntityLogoWritePayload {
  id?: string;
  userId: number;
  name: string;
  status: string;
  type?: BUDGET_TYPES;
  categoryIds?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  autoInclude?: boolean;
  limitAmount?: Money | null;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

const prepareTransactionFilters = (payload: CreateBudgetPayload) => ({
  userId: payload.userId,
  startDate: payload.startDate,
  endDate: payload.endDate,
  autoInclude: payload.autoInclude,
});

export const createBudget = withTransaction(async (payload: CreateBudgetPayload) => {
  const budgetType = payload.type ?? BUDGET_TYPES.manual;
  const aiEnabled = payload.aiEnabled ?? false;
  assertSmartTrackingConfig({
    type: budgetType,
    aiEnabled,
    aiDescription: payload.aiDescription,
    startDate: payload.startDate,
  });

  const categoryIds =
    budgetType === BUDGET_TYPES.category && payload.categoryIds?.length
      ? await assertCategoriesOwnedByUser({ userId: payload.userId, categoryIds: payload.categoryIds })
      : [];

  const logoPatch = await applyLogoWrite({
    write: {
      logoDomain: payload.logoDomain,
      logoInitials: payload.logoInitials,
      logoColor: payload.logoColor,
      logoIcon: payload.logoIcon,
      logoImage: payload.logoImage,
    },
  });

  const budget = await Budgets.create({
    name: payload.name,
    userId: payload.userId,
    status: payload.status || BUDGET_STATUSES.active,
    type: budgetType,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    autoInclude: payload.autoInclude ?? false,
    limitAmount: payload.limitAmount ?? null,
    aiEnabled,
    aiDescription: payload.aiDescription ?? null,
    ...(payload.aiPreWindowDays !== undefined && { aiPreWindowDays: payload.aiPreWindowDays }),
    ...logoPatch,
  });
  if (aiEnabled) {
    await startFeatureTrial({
      userId: payload.userId,
      feature: AI_FEATURE_ENTITLEMENTS[AI_FEATURE.trackerMatching],
    });
    await runAfterCommit({ fn: () => enqueueTrackerScan({ budgetId: budget.id }) });
  }

  // For category-based budgets, create BudgetCategories entries
  if (categoryIds.length) {
    // Expand parent categories to include children
    const expandedCategoryIds = await expandCategoryIds({
      userId: payload.userId,
      categoryIds,
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

  // For manual budgets with autoInclude, link transactions by date range
  if (budgetType === BUDGET_TYPES.manual && payload.autoInclude && payload.startDate && payload.endDate) {
    const transactionFilters = prepareTransactionFilters(payload);
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

  // Reload budget with categories for category-based budgets
  const reloadedBudget = await Budgets.findByPk(budget.id, {
    attributes: { exclude: ['userId'] },
    include: budgetType === BUDGET_TYPES.category ? [includeCategories] : [],
  });

  return reloadedBudget!;
});
