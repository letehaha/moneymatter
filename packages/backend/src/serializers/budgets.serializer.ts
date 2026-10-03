/**
 * Budget Serializers
 *
 * Serializes budget model instances for API responses.
 * Money fields auto-convert via .toNumber().
 * Deserializers convert API decimal inputs to Money.
 */
import { BUDGET_TYPES, ResourceShareInfo } from '@bt/shared/types';
import { Money, centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import type Budgets from '@models/budget.model';
import type { BudgetShareContext } from '@services/sharing/get-shared-budgets.service';

// ============================================================================
// Response Types
// ============================================================================

interface BudgetCategoryResponse {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface BudgetTagResponse {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

interface BudgetApiResponse {
  id: string;
  userId: number;
  name: string;
  status: string;
  type: BUDGET_TYPES;
  startDate: Date | null;
  endDate: Date | null;
  autoInclude: boolean;
  limitAmount: number | null;
  categories: BudgetCategoryResponse[];
  tags: BudgetTagResponse[];
  /** Present on user-facing list/detail responses when share context is attached. */
  share?: ResourceShareInfo;
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize a budget from DB format to API response
 */
export function serializeBudget(budget: Budgets & { _shareContext?: BudgetShareContext }): BudgetApiResponse {
  const categories: BudgetCategoryResponse[] = (budget.categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    parentId: c.parentId,
  }));

  const tags: BudgetTagResponse[] = (budget.tags || []).map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    icon: tag.icon,
  }));

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
    categories,
    tags,
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

interface BudgetStatsApiResponse {
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number;
    utilizationRate: number | null;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
}

interface BudgetStatsInternal {
  summary: {
    actualIncome: number | Money;
    actualExpense: number | Money;
    balance: number | Money;
    utilizationRate: number | null;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
}

/**
 * Serialize budget stats to API decimal format
 */
export function serializeBudgetStats(stats: BudgetStatsInternal): BudgetStatsApiResponse {
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
  };
}

// ============================================================================
// Budget Spending Stats Serializer
// ============================================================================

interface SpendingCategoryInternal {
  categoryId: string;
  name: string;
  color: string;
  amount: number; // cents
  children?: SpendingCategoryInternal[];
}

interface SpendingStatsInternal {
  spendingsByCategory: SpendingCategoryInternal[];
  spendingOverTime: {
    granularity: 'monthly' | 'weekly';
    periods: {
      periodStart: string;
      periodEnd: string;
      expense: number; // cents
      income: number; // cents
    }[];
  };
}

function serializeSpendingCategory(item: SpendingCategoryInternal) {
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

export function serializeBudgetSpendingStats(stats: SpendingStatsInternal) {
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
  };
}
