import { createController } from '@controllers/helpers/controller-factory';
import { listAuthSessions } from '@services/user/list-auth-sessions.service';
import { z } from 'zod';

export const listAuthSessionsController = createController(z.object({}), async ({ user }) => {
  const sessions = await listAuthSessions({ authUserId: user.authUserId });
  return { data: sessions };
});
