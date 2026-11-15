import { CHAT_MESSAGE_MAX_CHARS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { commentOnProposal } from '@services/chat/proposals/comment';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.strictObject({ text: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_CHARS) }),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await commentOnProposal({ user, proposalId: params.id, text: body.text }),
  statusCode: 202,
}));
