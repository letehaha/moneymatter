import type { BudgetPlanDetails, BudgetPlanModel } from '@bt/shared/types';
import { Money, moneyToApiDecimalOrNull } from '@common/types/money';

type PlanSource = Omit<BudgetPlanModel, 'expectedIncome' | 'userId' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  /** A model row holds `Money`; the plan details hold the API decimal. */
  expectedIncome: Money | number | null;
  deletedAt: Date | string | null;
};

/**
 * A budget plan as an assistant reads it: the plan's settings and cadence, with the income as a
 * decimal in the plan currency. Left out: the owner id and the audit timestamps. `deletedAt` stays,
 * because `includeDeleted` lists plans that are in the trash.
 */
export function presentBudgetPlan({ plan }: { plan: PlanSource }) {
  return {
    id: plan.id,
    name: plan.name,
    type: plan.type,
    currencyCode: plan.currencyCode,
    cadence: plan.cadence,
    intervalN: plan.intervalN,
    anchorDate: plan.anchorDate,
    secondAnchorDay: plan.secondAnchorDay,
    epochDate: plan.epochDate,
    carryPolicy: plan.carryPolicy,
    autoAttachAccounts: plan.autoAttachAccounts,
    poolFrom: plan.poolFrom,
    zeroSum: plan.zeroSum,
    expectedIncome:
      plan.expectedIncome instanceof Money ? moneyToApiDecimalOrNull(plan.expectedIncome) : plan.expectedIncome,
    deletedAt: plan.deletedAt instanceof Date ? plan.deletedAt.toISOString() : plan.deletedAt,
  };
}

/** One plan with its attached account ids and lines (the lines as the service returns them). */
export function presentBudgetPlanDetails({ details }: { details: BudgetPlanDetails }) {
  return { plan: presentBudgetPlan({ plan: details.plan }), accountIds: details.accountIds, lines: details.lines };
}
