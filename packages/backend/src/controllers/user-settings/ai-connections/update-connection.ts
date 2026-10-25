import { createController } from '@controllers/helpers/controller-factory';
import { updateConnection } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { apiKeyField, baseUrlField, modelField, nameField } from './connection-field-schemas';

const schema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
  body: z.object({
    name: nameField.optional(),
    model: modelField.optional(),
    baseUrl: baseUrlField.optional(),
    apiKey: apiKeyField.optional().nullable(),
    // CLI providers: re-authenticates with a finished sign-in session
    cliAuthSessionId: z.uuid().optional(),
  }),
});

export const updateConnectionController = createController(schema, async ({ user, params, body }) => {
  const connection = await updateConnection({ userId: user.id, connectionId: params.id, ...body });

  return { data: connection };
});
