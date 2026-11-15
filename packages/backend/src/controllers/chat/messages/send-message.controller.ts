import { CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_MESSAGE_MAX_CHARS, CHAT_CLARIFICATION_LIMITS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { startChatRun } from '@services/chat/runs/start-run';
import { z } from 'zod';

const clarificationAnswerSchema = z.strictObject({
  clarificationId: recordId(),
  optionIds: z.array(z.string().max(100)).max(CHAT_CLARIFICATION_LIMITS.maxOptions),
  freeText: z.string().max(CHAT_CLARIFICATION_LIMITS.freeTextMaxChars).optional(),
});

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z
    .strictObject({
      text: z.string().trim().max(CHAT_MESSAGE_MAX_CHARS),
      attachmentIds: z.array(recordId()).max(CHAT_ATTACHMENTS_PER_MESSAGE).default([]),
      clarificationAnswer: clarificationAnswerSchema.optional(),
    })
    .refine((body) => body.text.length > 0 || body.attachmentIds.length > 0 || body.clarificationAnswer !== undefined, {
      message: 'A message needs text, an attachment or an answer to a question',
      path: ['text'],
    }),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await startChatRun({
    user,
    threadId: params.id,
    text: body.text,
    attachmentIds: body.attachmentIds,
    clarificationAnswer: body.clarificationAnswer,
  }),
  statusCode: 202,
}));
