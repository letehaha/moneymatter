import { createController } from '@controllers/helpers/controller-factory';
import { serializeVentureDeal } from '@root/serializers';
import { createVentureDeal } from '@services/venture/deals/create.service';
import { z } from 'zod';

import { createVentureDealBodyShape } from '../schemas';

export default createController(
  z.object({
    body: z.object(createVentureDealBodyShape),
  }),
  async ({ user, body }) => {
    const deal = await createVentureDeal({ userId: user.id, ...body });
    return { data: serializeVentureDeal(deal) };
  },
);
