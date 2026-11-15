import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { approveAllSafeCards } from '@services/chat/proposals/approve-all';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.strictObject({
    revisions: z.record(recordId(), z.number().int().min(1)),
  }),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await approveAllSafeCards({ user, messageId: params.id, revisions: body.revisions }),
}));
