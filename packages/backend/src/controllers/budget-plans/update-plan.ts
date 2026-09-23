import { BUDGET_PLAN_CARRY_POLICIES, BUDGET_PLAN_NAME_MAX_LENGTH } from '@bt/shared/types/budget-plans';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePlan } from '@services/budget-plans/update-plan';
import { z } from 'zod';

// Cadence, anchor, epoch and type are immutable, so sending one is a client bug and the strict schema returns a 422.
const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({
    name: z.string().trim().min(1).max(BUDGET_PLAN_NAME_MAX_LENGTH).optional(),
    autoAttachAccounts: z.boolean().optional(),
    carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updatePlan({ userId: user.id, planId: params.planId, ...body });

  return { data };
});
