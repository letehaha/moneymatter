import { CHAT_RETENTION_OPTIONS } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { setChatRetention } from '@services/chat/threads/retention.service';
import { z } from 'zod';

const schema = z.object({
  body: z.object({
    // `null` is "never"; a missing key is a malformed request, not a choice.
    retentionDays: z.literal([...CHAT_RETENTION_OPTIONS]).nullable(),
  }),
});

export const updateChatSettings = createController(schema, async ({ user, body }) => ({
  data: await setChatRetention({ userId: user.id, retentionDays: body.retentionDays }),
}));
