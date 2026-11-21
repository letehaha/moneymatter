import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import { setPlanAccountsBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: setPlanAccountsBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await setPlanAccounts({ userId: user.id, planId: params.planId, accountIds: body.accountIds });

  return { data };
});
