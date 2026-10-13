import { BUDGET_PLAN_CADENCES, BUDGET_PLAN_CARRY_POLICIES, BUDGET_PLAN_TYPE_KEYS } from '@bt/shared/types';
import { budgetPlanName, budgetSuggestionAnswers, dateBound, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createPlan } from '@services/budget-plans/create-plan';
import { z } from 'zod';

const schema = z.object({
  body: z.strictObject({
    name: budgetPlanName(),
    type: z.enum(BUDGET_PLAN_TYPE_KEYS),
    cadence: z.enum(BUDGET_PLAN_CADENCES),
    intervalN: z.number().int().min(1).optional(),
    anchorDate: dateBound(),
    secondAnchorDay: z.number().int().min(1).max(31).optional(),
    epochDate: dateBound().optional(),
    accountIds: uniqueRecordIds({ min: 1 }),
    autoAttachAccounts: z.boolean().optional(),
    carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
    poolEnabled: z.boolean().optional(),
    withSuggestedLines: z.boolean().optional(),
    suggestionAnswers: budgetSuggestionAnswers().optional(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  const data = await createPlan({ userId: user.id, ...body });

  return { data, statusCode: 201 };
});
