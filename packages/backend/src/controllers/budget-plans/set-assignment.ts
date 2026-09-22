import { BUDGET_PLAN_CARRY_POLICIES } from '@bt/shared/types/budget-plans';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setAssignment } from '@services/budget-plans/set-assignment';
import { z } from 'zod';

// `undefined` leaves a field untouched, `null` clears it, so an empty body is
// the one thing that cannot be meant.
const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId(), lineId: recordId() }),
  body: z
    .strictObject({
      scope: z.enum(['from_here', 'this_period']),
      amount: z.number().min(0).nullable().optional(),
      carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).nullable().optional(),
    })
    .refine((body) => body.amount !== undefined || body.carryPolicy !== undefined, {
      message: 'Provide amount, carryPolicy, or both.',
    }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await setAssignment({ userId: user.id, ...params, ...body });

  return { data };
});
