import { ACCOUNT_CATEGORIES } from './enums';
import { RecordId } from './record-id';

export const BUDGET_PLAN_CADENCES = ['days', 'months', 'semi_monthly'] as const;
export type BudgetPlanCadence = (typeof BUDGET_PLAN_CADENCES)[number];

export const BUDGET_PLAN_CARRY_POLICIES = ['none', 'floor', 'signed'] as const;
export type BudgetPlanCarryPolicy = (typeof BUDGET_PLAN_CARRY_POLICIES)[number];

export const BUDGET_PLAN_TYPE_KEYS = ['category_caps'] as const;
export type BudgetPlanTypeKey = (typeof BUDGET_PLAN_TYPE_KEYS)[number];

/** The half of a plan type the frontend needs; the fold-time half lives in the backend registry. */
export interface BudgetPlanTypeDescriptor {
  carryDefault: BudgetPlanCarryPolicy;
}

export const BUDGET_PLAN_TYPE_DESCRIPTORS: Record<BudgetPlanTypeKey, BudgetPlanTypeDescriptor> = {
  category_caps: { carryDefault: 'none' },
};

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
