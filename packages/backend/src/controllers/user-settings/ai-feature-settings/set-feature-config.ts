import { AI_FEATURE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getStoredAiSettings } from '@services/user-settings/ai-connections';
import { setFeatureConfig } from '@services/user-settings/ai-feature-settings';
import { resolveFeatureStatus } from '@services/user-settings/resolve-feature-model-display';
import { z } from 'zod';

import { resolvePaidPlus, resolveServerKeysAllowed } from './build-feature-status-payload';

const schema = z.object({
  params: z.object({
    feature: z.nativeEnum(AI_FEATURE),
  }),
  body: z.object({
    // null pins the included server model
    connectionId: z.uuid().nullable(),
  }),
});

export const setFeatureConfigController = createController(schema, async ({ user, params, body, req }) => {
  const { id: userId } = user;
  const { feature } = params;

  const serverKeysAllowed = await resolveServerKeysAllowed({ req, feature });
  const paidPlus = await resolvePaidPlus({ req });

  await setFeatureConfig({ userId, feature, connectionId: body.connectionId, serverKeysAllowed, paidPlus });

  return {
    data: await resolveFeatureStatus({
      feature,
      aiSettings: await getStoredAiSettings({ userId }),
      serverKeysAllowed,
      paidPlus,
    }),
  };
});
