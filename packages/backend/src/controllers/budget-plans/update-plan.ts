import { BUDGET_PLAN_CARRY_POLICIES } from '@bt/shared/types/budget-plans';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePlan } from '@services/budget-plans/update-plan';
import { z } from 'zod';

// Strict: cadence, anchor, epoch and type are immutable in slice 1, so sending
// one is a client bug worth a 422 instead of a silently ignored key.
const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    autoAttachAccounts: z.boolean().optional(),
    carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updatePlan({ userId: user.id, planId: params.planId, ...body });

  return { data };
});
