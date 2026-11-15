import { type ChatDefaultConnection } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { pickDefaultThreadChoice } from '@services/chat/threads/thread-connection';
import { z } from 'zod';

const schema = z.object({});

export default createController(schema, async ({ user }) => {
  const data: ChatDefaultConnection = await pickDefaultThreadChoice({ userId: user.id });
  return { data };
});
