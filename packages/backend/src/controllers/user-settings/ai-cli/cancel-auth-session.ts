import { createController } from '@controllers/helpers/controller-factory';
import { cancelCliAuthSession } from '@services/user-settings/ai-cli-auth';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
});

export const cancelCliAuthSessionController = createController(schema, async ({ user, params }) => {
  cancelCliAuthSession({ userId: user.id, sessionId: params.id });

  return { statusCode: 204 };
});
