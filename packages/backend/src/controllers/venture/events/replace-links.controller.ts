import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { replaceLinksBodySchema } from '@controllers/venture/events/schemas';
import { serializeVentureEventLink } from '@root/serializers';
import { replaceEventLinks } from '@services/venture/linking/replace-event-links.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: replaceLinksBodySchema,
  }),
  async ({ user, params, body }) => {
    const links = await replaceEventLinks({
      userId: user.id,
      eventId: params.id,
      transactionIds: body.transactionIds,
    });
    return { data: links.map(serializeVentureEventLink) };
  },
);
