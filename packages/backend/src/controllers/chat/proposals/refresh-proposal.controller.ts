import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { refreshProposal } from '@services/chat/proposals/refresh';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => ({
  data: await refreshProposal({ userId: user.id, proposalId: params.id }),
}));
