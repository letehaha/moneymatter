import { AI_PROVIDER } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { createConnection } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { apiKeyField, baseUrlField, modelField, nameField } from './connection-field-schemas';

const schema = z.object({
  body: z.object({
    provider: z.enum(AI_PROVIDER),
    name: nameField,
    model: modelField,
    // Required for `custom`, refused for native providers
    baseUrl: baseUrlField.optional(),
    apiKey: apiKeyField.optional(),
    keyFromConnectionId: z.uuid().optional(),
  }),
});

export const createConnectionController = createController(schema, async ({ user, body }) => {
  const connection = await createConnection({ userId: user.id, ...body });

  return { data: connection, statusCode: 201 };
});
