import { AIFeatureStatus, AIFeaturesStatusResponse, AI_FEATURE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getRequestEntitlements } from '@middlewares/entitlements';
import { getAiAllowance } from '@services/ai/ai-allowance';
import { getStoredAiSettings } from '@services/user-settings/ai-connections';
import { z } from 'zod';

import { buildFeatureStatusPayload } from './build-feature-status-payload';

const schema = z.object({});

export const getFeaturesStatus = createController(schema, async ({ user, req }) => {
  const aiSettings = await getStoredAiSettings({ userId: user.id });
  const aiAllowance = await getAiAllowance({ userId: user.id, entitlements: await getRequestEntitlements({ req }) });
  const withinAllowance = aiAllowance?.state !== 'reached';
  const features: AIFeatureStatus[] = [];

  for (const feature of Object.values(AI_FEATURE)) {
    features.push(await buildFeatureStatusPayload({ req, feature, aiSettings, withinAllowance }));
  }

  return {
    data: { features, aiAllowance } satisfies AIFeaturesStatusResponse,
  };
});
