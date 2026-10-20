import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVentureDeal } from '@root/serializers';
import { updateVentureDeal } from '@services/venture/deals/update.service';
import { z } from 'zod';

import { updateVentureDealBodySchema } from '../schemas';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: updateVentureDealBodySchema,
  }),
  async ({ user, params, body }) => {
    const deal = await updateVentureDeal({ userId: user.id, dealId: params.id, ...body });
    return { data: serializeVentureDeal(deal) };
  },
);
