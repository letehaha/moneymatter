import { BUDGET_PLAN_TYPE_DESCRIPTORS } from '@bt/shared/types/budget-plans';

import type { BudgetPlanHeaderLine, BudgetPlanTypeDefinition } from './index';

const sum = ({ lines, pick }: { lines: BudgetPlanHeaderLine[]; pick: (line: BudgetPlanHeaderLine) => number }) =>
  lines.reduce((total, line) => total + pick(line), 0);

export const categoryCaps: BudgetPlanTypeDefinition = {
  ...BUDGET_PLAN_TYPE_DESCRIPTORS.category_caps,
  deriveHeader: ({ lines }) => ({
    totalAssigned: sum({ lines, pick: (line) => line.assigned }),
    totalActivity: sum({ lines, pick: (line) => line.activity }),
    totalAvailable: sum({ lines, pick: (line) => line.available }),
  }),
};
