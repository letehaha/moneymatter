import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({ accountIds: uniqueRecordIds() }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await setPlanAccounts({ userId: user.id, planId: params.planId, accountIds: body.accountIds });

  return { data };
});
