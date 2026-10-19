/**
 * Budget Serializers
 *
 * Serializes budget model instances for API responses.
 * Money fields auto-convert via .toNumber().
 * Deserializers convert API decimal inputs to Money.
 */
import {
  BUDGET_TYPES,
  type BudgetSpendingByCategoryItem,
  type BudgetSpendingStatsResponse,
  type BudgetStatsResponse,
  type EntityLogoFields,
  ResourceShareInfo,
} from '@bt/shared/types';
import { centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import type Budgets from '@models/budget.model';
import type Categories from '@models/categories.model';
import type TrackerLines from '@models/tracker-lines.model';
import type { SpendingStatsResponse } from '@services/budgets/spending-stats';
import type { StatsResponse } from '@services/budgets/stats';
import type { BudgetShareContext } from '@services/sharing/get-shared-budgets.service';

import { serializeLogoFields } from './logo-fields.serializer';

// ============================================================================
// Response Types
// ============================================================================

interface BudgetCategoryResponse {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface BudgetApiResponse extends EntityLogoFields {
  id: string;
  userId: number;
  name: string;
  status: string;
  type: BUDGET_TYPES;
  startDate: Date | null;
  endDate: Date | null;
  autoInclude: boolean;
  limitAmount: number | null;
  archivePromptDismissed: boolean;
  aiEnabled: boolean;
  aiDescription: string | null;
  aiPreWindowDays: number;
  aiLastScannedAt: Date | null;
  categories: BudgetCategoryResponse[];
  lines: TrackerLineResponse[];
  /** Present on user-facing list/detail responses when share context is attached. */
  share?: ResourceShareInfo;
}

interface TrackerLineResponse {
  id: string;
  budgetId: string;
  name: string;
  limitAmount: number | null;
  position: number;
  categories: BudgetCategoryResponse[];
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

const serializeEmbeddedCategories = (categories: Categories[] | undefined): BudgetCategoryResponse[] =>
  (categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    parentId: c.parentId,
  }));

export function serializeTrackerLine(line: TrackerLines): TrackerLineResponse {
  return {
    id: line.id,
    budgetId: line.budgetId,
    name: line.name,
    limitAmount: centsToApiDecimalOrNull(line.limitAmount),
    position: line.position,
    categories: serializeEmbeddedCategories(line.categories),
  };
}

/**
 * Serialize a budget from DB format to API response
 */
export function serializeBudget(budget: Budgets & { _shareContext?: BudgetShareContext }): BudgetApiResponse {
  const categories = serializeEmbeddedCategories(budget.categories);
  // Smart tracking is owner-only; its description and scan state are not for recipients.
  const isRecipient = budget._shareContext !== undefined && !budget._shareContext.isOwner;

  const response: BudgetApiResponse = {
    id: budget.id,
    userId: budget.userId,
    name: budget.name,
    status: budget.status,
    type: budget.type,
    startDate: budget.startDate,
    endDate: budget.endDate,
    autoInclude: budget.autoInclude,
    limitAmount: centsToApiDecimalOrNull(budget.limitAmount),
    archivePromptDismissed: budget.archivePromptDismissed,
    aiEnabled: isRecipient ? false : budget.aiEnabled,
    aiDescription: isRecipient ? null : budget.aiDescription,
    aiPreWindowDays: budget.aiPreWindowDays,
    aiLastScannedAt: isRecipient ? null : budget.aiLastScannedAt,
    ...serializeLogoFields({ entity: budget }),
    categories,
    lines: (budget.lines || []).map(serializeTrackerLine),
  };

  if (budget._shareContext) {
    response.share = {
      isOwner: budget._shareContext.isOwner,
      owner: budget._shareContext.owner,
      permission: budget._shareContext.permission,
      policy: budget._shareContext.policy,
      accessSource: budget._shareContext.accessSource,
    };
  }

  return response;
}

/**
 * Serialize multiple budgets
 */
export function serializeBudgets(
  budgets: Array<Budgets & { _shareContext?: BudgetShareContext }>,
): BudgetApiResponse[] {
  return budgets.map(serializeBudget);
}

// ============================================================================
// Budget Stats Serializer
// ============================================================================

/**
 * Serialize budget stats to API decimal format
 */
export function serializeBudgetStats(stats: StatsResponse): BudgetStatsResponse {
  return {
    summary: {
      actualIncome: centsToApiDecimal(stats.summary.actualIncome),
      actualExpense: centsToApiDecimal(stats.summary.actualExpense),
      balance: centsToApiDecimal(stats.summary.balance),
      utilizationRate: stats.summary.utilizationRate,
      transactionsCount: stats.summary.transactionsCount,
      firstTransactionDate: stats.summary.firstTransactionDate,
      lastTransactionDate: stats.summary.lastTransactionDate,
    },
    lines: stats.lines.map((line) => ({ lineId: line.lineId, spent: centsToApiDecimal(line.spent) })),
    otherSpent: centsToApiDecimal(stats.otherSpent),
  };
}

// ============================================================================
// Budget Spending Stats Serializer
// ============================================================================

function serializeSpendingCategory(
  item: SpendingStatsResponse['spendingsByCategory'][number],
): BudgetSpendingByCategoryItem {
  return {
    categoryId: item.categoryId,
    name: item.name,
    color: item.color,
    amount: centsToApiDecimal(item.amount),
    ...(item.children?.length && {
      children: item.children.map(serializeSpendingCategory),
    }),
  };
}

export function serializeBudgetSpendingStats(stats: SpendingStatsResponse): BudgetSpendingStatsResponse {
  return {
    spendingsByCategory: stats.spendingsByCategory.map(serializeSpendingCategory),
    spendingOverTime: {
      granularity: stats.spendingOverTime.granularity,
      periods: stats.spendingOverTime.periods.map((period) => ({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        expense: centsToApiDecimal(period.expense),
        income: centsToApiDecimal(period.income),
      })),
    },
    spendingsByCurrency: stats.spendingsByCurrency.map((item) => ({
      currencyCode: item.currencyCode,
      amount: centsToApiDecimal(item.amount),
      refAmount: centsToApiDecimal(item.refAmount),
    })),
    topPayees: stats.topPayees.map((payee) => ({ ...payee, amount: centsToApiDecimal(payee.amount) })),
    biggestDay: stats.biggestDay && {
      date: stats.biggestDay.date,
      expense: centsToApiDecimal(stats.biggestDay.expense),
    },
  };
}
