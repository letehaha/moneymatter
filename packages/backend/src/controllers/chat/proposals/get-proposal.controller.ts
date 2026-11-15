import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getProposalCard } from '@services/chat/proposals/get';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => ({
  data: await getProposalCard({ userId: user.id, proposalId: params.id }),
}));
