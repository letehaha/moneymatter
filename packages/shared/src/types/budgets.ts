import type { EmbeddedCategoryModel } from './categories';
import type { RecordId } from './record-id';
import type { ResourceShareInfo } from './sharing';

export enum BUDGET_STATUSES {
  active = 'active',
  closed = 'closed',
  archived = 'archived',
}

export enum BUDGET_TYPES {
  manual = 'manual',
  category = 'category',
}

export interface BudgetModel {
  id: RecordId;
  userId: number;
  status: string;
  name: string;
  type: BUDGET_TYPES;
  startDate?: Date;
  endDate?: Date;
  limitAmount?: number;
  autoInclude?: boolean;
  /**
   * Category IDs for category-based budgets.
   * Use for CREATE/UPDATE requests - the backend will expand parent IDs to include children.
   * Not populated in GET responses (use `categories` array instead).
   */
  categoryIds?: string[];
  /**
   * Full category objects for category-based budgets.
   * Populated in GET responses when budget has associated categories.
   * Read-only - for mutations, use `categoryIds`.
   */
  categories?: EmbeddedCategoryModel[];
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

// Budget Spending Stats
export interface BudgetSpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // decimal, positive (expenses only)
  children?: BudgetSpendingByCategoryItem[];
}

export interface BudgetSpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // decimal, positive
  income: number; // decimal, positive
}

export interface BudgetSpendingStatsResponse {
  spendingsByCategory: BudgetSpendingByCategoryItem[];
  spendingOverTime: {
    granularity: 'monthly' | 'weekly';
    periods: BudgetSpendingPeriod[];
  };
}
