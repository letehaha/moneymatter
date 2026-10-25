import { createController } from '@controllers/helpers/controller-factory';
import { getCliAuthSession } from '@services/user-settings/ai-cli-auth';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
});

export const getCliAuthSessionController = createController(schema, async ({ user, params }) => {
  const data = getCliAuthSession({ userId: user.id, sessionId: params.id });

  return { data };
});
