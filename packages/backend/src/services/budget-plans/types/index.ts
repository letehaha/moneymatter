import { BudgetPlanTypeDescriptor, BudgetPlanTypeKey } from '@bt/shared/types/budget-plans';

import { categoryCaps } from './category-caps';

/** Cents, one line of the period the header is derived from. */
export interface BudgetPlanHeaderLine {
  assigned: number;
  activity: number;
  available: number;
}

/** Cents. */
export interface BudgetPlanHeader {
  totalAssigned: number;
  totalActivity: number;
  totalAvailable: number;
}

/** No `switch (type)` outside this registry. */
export type BudgetPlanTypeDefinition = BudgetPlanTypeDescriptor & {
  deriveHeader: (params: { lines: BudgetPlanHeaderLine[] }) => BudgetPlanHeader;
};

export const BUDGET_PLAN_TYPES: Record<BudgetPlanTypeKey, BudgetPlanTypeDefinition> = {
  category_caps: categoryCaps,
};
