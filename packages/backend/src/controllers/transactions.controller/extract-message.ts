import { createController } from '@controllers/helpers/controller-factory';
import { extractMessage } from '@services/document-extraction/extract-message.service';
import { z } from 'zod';

const schema = z.object({
  body: z.object({ text: z.string().trim().min(1).max(2000) }),
});

export default createController(
  schema,
  async ({ user, body }) => ({ data: await extractMessage({ userId: user.id, text: body.text }) }),
  { inBackground: true },
);
