import { createController } from '@controllers/helpers/controller-factory';
import { getCliAvailability } from '@services/user-settings/ai-cli-auth';
import { z } from 'zod';

const schema = z.object({});

export const getCliAvailabilityController = createController(schema, async ({ user }) => {
  const data = await getCliAvailability({ userId: user.id });

  return { data };
});
