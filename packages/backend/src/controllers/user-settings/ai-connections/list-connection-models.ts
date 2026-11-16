import { AI_PROVIDER } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { listAvailableModels } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { apiKeyField, baseUrlField } from './connection-field-schemas';

const schema = z.object({
  body: z.object({
    provider: z.enum(AI_PROVIDER),
    baseUrl: baseUrlField.optional(),
    apiKey: apiKeyField.optional(),
    connectionId: z.uuid().optional(),
  }),
});

export const listConnectionModelsController = createController(schema, async ({ user, body }) => {
  const models = await listAvailableModels({ userId: user.id, ...body });

  return { data: { models } };
});
