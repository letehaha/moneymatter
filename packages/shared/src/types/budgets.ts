import type { EmbeddedCategoryModel } from './categories';
import type { RecordId } from './record-id';
import type { ResourceShareInfo } from './sharing';

// Everything in this file belongs to the user-facing "Trackers" (`Budgets` table).
// The user-facing "Budget" is typed in budget-plans.ts.
export enum BUDGET_STATUSES {
  active = 'active',
  closed = 'closed',
  archived = 'archived',
}

export enum BUDGET_TYPES {
  manual = 'manual',
  category = 'category',
}

/** Per-category limit inside a tracker (`TrackerLines` table). */
export interface TrackerLineModel {
  id: RecordId;
  budgetId: RecordId;
  name: string;
  /** Decimal; null = no limit on this line. */
  limitAmount: number | null;
  position: number;
  categories: EmbeddedCategoryModel[];
}

export interface TrackerLinePayload {
  name: string;
  limitAmount?: number | null;
  /** Parent ids are expanded to children server-side. */
  categoryIds: string[];
  position?: number;
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
  /** The "Archive?" suggestion chip stays hidden once the user opts out for this tracker. */
  archivePromptDismissed: boolean;
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
  /** Ordered by `position`. Present on GET list/detail responses. */
  lines: TrackerLineModel[];
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

export interface BudgetStatsLine {
  lineId: RecordId;
  /** Decimal, positive. Net expenses matched to this line. */
  spent: number;
}

export interface BudgetStatsResponse {
  summary: {
    actualIncome: number;
    actualExpense: number;
    /** Net difference, income minus expenses. */
    balance: number;
    /** Percentage used (0-100+), null without an overall limit. */
    utilizationRate: null | number;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
  /** One entry per tracker line, in line order. */
  lines: BudgetStatsLine[];
  /** Decimal, positive. Expenses not matched by any line. */
  otherSpent: number;
}

// Budget Spending Stats
export interface BudgetSpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // decimal, positive (expenses only)
  children?: BudgetSpendingByCategoryItem[];
}

export type BudgetSpendingGranularity = 'monthly' | 'weekly' | 'daily';

export interface BudgetSpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // decimal, positive
  income: number; // decimal, positive
}

export interface BudgetSpendingByCurrencyItem {
  currencyCode: string;
  /** Decimal, positive, in `currencyCode`. */
  amount: number;
  /** Decimal, positive, in the base currency. */
  refAmount: number;
}

export interface BudgetSpendingPayeeItem {
  payeeId: RecordId | null;
  name: string | null;
  /** Decimal, positive, base currency. */
  amount: number;
  transactionsCount: number;
}

export interface BudgetSpendingStatsResponse {
  spendingsByCategory: BudgetSpendingByCategoryItem[];
  spendingOverTime: {
    granularity: BudgetSpendingGranularity;
    periods: BudgetSpendingPeriod[];
  };
  /** Expenses grouped by original transaction currency, largest `refAmount` first. */
  spendingsByCurrency: BudgetSpendingByCurrencyItem[];
  /** Top 5 payees by expense, base currency. */
  topPayees: BudgetSpendingPayeeItem[];
  /** The single calendar day with the highest expense, null without expenses. */
  biggestDay: { date: string; expense: number } | null;
}
