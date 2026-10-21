import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { approveProposal } from '@services/chat/proposals/approve';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.strictObject({
    revision: z.number().int().min(1),
    parentRevisions: z.record(recordId(), z.number().int().min(1)).optional(),
    confirmation: z.string().max(200).optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await approveProposal({
    user,
    proposalId: params.id,
    revision: body.revision,
    parentRevisions: body.parentRevisions,
    confirmation: body.confirmation,
  }),
}));
