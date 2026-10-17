import { AI_FEATURE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getStoredAiSettings } from '@services/user-settings/ai-connections';
import { clearFeatureConfig } from '@services/user-settings/ai-feature-settings';
import { z } from 'zod';

import { buildFeatureStatusPayload, isRequestWithinAiAllowance } from './build-feature-status-payload';

const schema = z.object({
  params: z.object({
    feature: z.nativeEnum(AI_FEATURE),
  }),
});

export const resetFeatureConfigController = createController(schema, async ({ user, params, req }) => {
  const { id: userId } = user;
  const { feature } = params;

  await clearFeatureConfig({ userId, feature });

  return {
    data: await buildFeatureStatusPayload({
      req,
      feature,
      aiSettings: await getStoredAiSettings({ userId }),
      withinAllowance: await isRequestWithinAiAllowance({ req }),
    }),
  };
});
