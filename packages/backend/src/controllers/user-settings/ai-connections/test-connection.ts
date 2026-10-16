import { AI_PROVIDER } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { testConnection } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { apiKeyField, baseUrlField, modelField } from './connection-field-schemas';

const savedConnectionBody = z.object({
  connectionId: z.uuid(),
  model: modelField.optional(),
  baseUrl: baseUrlField.optional(),
  apiKey: apiKeyField.optional(),
  cliAuthSessionId: z.uuid().optional(),
});

// Test a combination the user typed in, before it is saved anywhere.
const draftConnectionBody = z.object({
  provider: z.nativeEnum(AI_PROVIDER),
  model: modelField,
  baseUrl: baseUrlField.optional(),
  apiKey: apiKeyField.optional(),
  keyFromConnectionId: z.uuid().optional(),
  cliAuthSessionId: z.uuid().optional(),
});

const schema = z.object({
  body: z.union([savedConnectionBody, draftConnectionBody]),
});

export const testConnectionController = createController(schema, async ({ user, body }) => {
  const result = await testConnection({ userId: user.id, ...body });

  return { data: result };
});
