import { createController } from '@controllers/helpers/controller-factory';
import * as subscriptionsService from '@services/subscriptions';
import { z } from 'zod';

import { createSubscriptionBodySchema } from './shared-schemas';

const schema = z.object({
  body: createSubscriptionBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const subscription = await subscriptionsService.createSubscription({
    userId: user.id,
    ...body,
  });

  return { data: subscription, statusCode: 201 };
});
