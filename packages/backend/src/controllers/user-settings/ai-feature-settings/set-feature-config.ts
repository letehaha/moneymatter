import { AI_FEATURE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getStoredAiSettings } from '@services/user-settings/ai-connections';
import { setFeatureConfig } from '@services/user-settings/ai-feature-settings';
import { resolveFeatureStatus } from '@services/user-settings/resolve-feature-model-display';
import { z } from 'zod';

import { modelField } from '../ai-connections/connection-field-schemas';
import { isRequestWithinAiAllowance, resolveEntitledToServerKeys } from './build-feature-status-payload';

const schema = z.object({
  params: z.object({
    // Chat has no feature config: each thread carries its own connection.
    feature: z.enum(AI_FEATURE).exclude([AI_FEATURE.chat]),
  }),
  body: z.object({
    // null pins the included server model
    connectionId: z.uuid().nullable(),
    // A model of that connection's provider; omitted, the connection's own model
    modelId: modelField.optional(),
  }),
});

export const setFeatureConfigController = createController(schema, async ({ user, params, body, req }) => {
  const { id: userId } = user;
  const { feature } = params;

  const entitledToServerKeys = await resolveEntitledToServerKeys({ req, feature });

  await setFeatureConfig({
    userId,
    feature,
    connectionId: body.connectionId,
    modelId: body.modelId,
    entitledToServerKeys,
  });

  return {
    data: await resolveFeatureStatus({
      feature,
      aiSettings: await getStoredAiSettings({ userId }),
      serverKeysAllowed: entitledToServerKeys && (await isRequestWithinAiAllowance({ req })),
    }),
  };
});
