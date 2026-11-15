import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { editProposal } from '@services/chat/proposals/edit';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.strictObject({
    revision: z.number().int().min(1),
    args: z.record(z.string(), z.unknown()),
  }),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await editProposal({ userId: user.id, proposalId: params.id, revision: body.revision, args: body.args }),
}));
