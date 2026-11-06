import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as subscriptionsService from '@services/subscriptions';
import { z } from 'zod';

import { updateSubscriptionBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: updateSubscriptionBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const subscription = await subscriptionsService.updateSubscription({
    id: params.id,
    userId: user.id,
    ...body,
  });

  return { data: subscription };
});
