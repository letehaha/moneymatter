import { AI_CLI_PROVIDERS } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { startCliAuthSession } from '@services/user-settings/ai-cli-auth';
import { z } from 'zod';

const schema = z.object({
  body: z.object({
    provider: z.enum(AI_CLI_PROVIDERS),
  }),
});

export const startCliAuthSessionController = createController(schema, async ({ user, body }) => {
  const data = await startCliAuthSession({ userId: user.id, provider: body.provider });

  return { data, statusCode: 201 };
});
