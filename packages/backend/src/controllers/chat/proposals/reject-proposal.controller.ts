import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { rejectProposal } from '@services/chat/proposals/reject';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => ({
  data: await rejectProposal({ userId: user.id, proposalId: params.id }),
}));
