import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { appendLinksBodySchema } from '@controllers/venture/events/schemas';
import { serializeVentureEventLink } from '@root/serializers';
import { linkTxsToEvent } from '@services/venture/linking/link-txs-to-event.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: appendLinksBodySchema,
  }),
  async ({ user, params, body }) => {
    const links = await linkTxsToEvent({
      userId: user.id,
      eventId: params.id,
      transactionIds: body.transactionIds,
    });
    return { data: links.map(serializeVentureEventLink) };
  },
);
