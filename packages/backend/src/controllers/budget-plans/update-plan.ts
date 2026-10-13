import { BUDGET_PLAN_CARRY_POLICIES } from '@bt/shared/types';
import { boundedDecimalAmount, budgetPlanName, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePlan } from '@services/budget-plans/update-plan';
import { z } from 'zod';

// Cadence, anchor, epoch and type are immutable, so sending one is a client bug and the strict schema returns a 422.
const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({
    name: budgetPlanName().optional(),
    autoAttachAccounts: z.boolean().optional(),
    carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
    poolEnabled: z.boolean().optional(),
    zeroSum: z.boolean().optional(),
    expectedIncome: boundedDecimalAmount().nullable().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updatePlan({ userId: user.id, planId: params.planId, ...body });

  return { data };
});
