import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getSubscriptionPayPreview } from '@services/subscriptions/get-pay-preview';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  query: z.object({ periodId: recordId().optional() }).optional(),
});

export default createController(schema, async ({ user, params, query }) => {
  const preview = await getSubscriptionPayPreview({
    userId: user.id,
    subscriptionId: params.id,
    periodId: query?.periodId,
  });

  return { data: preview };
});
