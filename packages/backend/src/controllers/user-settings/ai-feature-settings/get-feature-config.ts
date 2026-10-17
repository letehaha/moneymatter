import { AI_FEATURE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getStoredAiSettings } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { buildFeatureStatusPayload, isRequestWithinAiAllowance } from './build-feature-status-payload';

const schema = z.object({
  params: z.object({
    feature: z.nativeEnum(AI_FEATURE),
  }),
});

export const getFeatureConfigController = createController(schema, async ({ user, params, req }) => {
  const aiSettings = await getStoredAiSettings({ userId: user.id });

  return {
    data: await buildFeatureStatusPayload({
      req,
      feature: params.feature,
      aiSettings,
      withinAllowance: await isRequestWithinAiAllowance({ req }),
    }),
  };
});
