import { ACCOUNT_CATEGORIES } from './enums';
import { RecordId } from './record-id';

export const BUDGET_PLAN_CADENCES = ['days', 'months', 'semi_monthly'] as const;
export type BudgetPlanCadence = (typeof BUDGET_PLAN_CADENCES)[number];

export const BUDGET_PLAN_CARRY_POLICIES = ['floor', 'signed', 'none'] as const;
export type BudgetPlanCarryPolicy = (typeof BUDGET_PLAN_CARRY_POLICIES)[number];

export const BUDGET_PLAN_TYPE_KEYS = ['category_caps'] as const;
export type BudgetPlanTypeKey = (typeof BUDGET_PLAN_TYPE_KEYS)[number];

export const BUDGET_PLAN_NAME_MAX_LENGTH = 200;

export const BUDGET_ASSIGNMENT_SCOPES = ['from_here', 'this_period'] as const;
export type BudgetAssignmentScope = (typeof BUDGET_ASSIGNMENT_SCOPES)[number];

/** The account categories a plan may attach. */
export const BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES: readonly ACCOUNT_CATEGORIES[] = [
  ACCOUNT_CATEGORIES.general,
  ACCOUNT_CATEGORIES.cash,
  ACCOUNT_CATEGORIES.currentAccount,
  ACCOUNT_CATEGORIES.saving,
  ACCOUNT_CATEGORIES.creditCard,
  ACCOUNT_CATEGORIES.overdraft,
];

export interface BudgetPlanModel {
  id: RecordId;
  userId: number;
  name: string;
  type: BudgetPlanTypeKey;
  /** Base currency stamped at creation; assigned amounts are in it. */
  currencyCode: string;
  cadence: BudgetPlanCadence;
  /** Every N days or months. Always 1 for `semi_monthly`. */
  intervalN: number;
  /** 'yyyy-MM-dd'. Period boundaries derive from it, never from the previous boundary. */
  anchorDate: string;
  /** Day of month, `semi_monthly` only. */
  secondAnchorDay: number | null;
  /** 'yyyy-MM-dd', the first budgeted day and a period start. */
  epochDate: string;
  carryPolicy: BudgetPlanCarryPolicy;
  autoAttachAccounts: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BudgetPlanLineEntry {
  id: string;
  name: string;
  sortOrder: number;
  activeFrom: string;
  activeUntil: string | null;
  categoryIds: string[];
}

export interface BudgetPlanDetails {
  plan: BudgetPlanModel;
  accountIds: string[];
  lines: BudgetPlanLineEntry[];
}

export interface BudgetPlanPeriod {
  id: string;
  startDate: string;
  /** Exclusive. */
  endDate: string;
  isCurrent: boolean;
}

export interface BudgetPlanPeriodViewLine {
  lineId: string;
  name: string;
  sortOrder: number;
  categoryIds: string[];
  assigned: number;
  assignedSource: 'override' | 'baseline' | 'none';
  /** Signed: expenses are negative. */
  activity: number;
  carriedIn: number;
  available: number;
  carryPolicy: BudgetPlanCarryPolicy;
}

export interface BudgetPlanPeriodView {
  period: BudgetPlanPeriod;
  header: { totalAssigned: number; totalActivity: number; totalAvailable: number };
  lines: BudgetPlanPeriodViewLine[];
  unbudgeted: { categoryId: string; activity: number }[];
}

export interface SetBudgetPlanAssignmentPayload {
  scope: BudgetAssignmentScope;
  /** `undefined` leaves the column untouched, `null` clears it. */
  amount?: number | null;
  carryPolicy?: BudgetPlanCarryPolicy | null;
}

export interface CreateBudgetPlanPayload {
  name: string;
  type: BudgetPlanTypeKey;
  cadence: BudgetPlanCadence;
  intervalN?: number;
  anchorDate: string;
  secondAnchorDay?: number;
  epochDate?: string;
  accountIds: string[];
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
}
