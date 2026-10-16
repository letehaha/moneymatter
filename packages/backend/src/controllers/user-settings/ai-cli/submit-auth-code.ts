import { createController } from '@controllers/helpers/controller-factory';
import { submitCliAuthCode } from '@services/user-settings/ai-cli-auth';
import { z } from 'zod';

const MAX_CODE_LENGTH = 500;

const schema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
  body: z.object({
    // Printable ASCII only: the code is typed into the CLI's terminal prompt
    code: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CODE_LENGTH)
      .regex(/^[\x20-\x7E]+$/),
  }),
});

export const submitCliAuthCodeController = createController(schema, async ({ user, params, body }) => {
  const data = submitCliAuthCode({ userId: user.id, sessionId: params.id, code: body.code });

  return { data };
});
