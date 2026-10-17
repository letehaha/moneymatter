import { type AI_FEATURE, type AI_PROVIDER, getModelNameFromModelId } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { trackEvent } from '@js/utils/posthog';

import { recordAiSpend } from './ai-allowance';
import { getModelProfile } from './model-catalog';

/**
 * Charges an answered call on a server key to the user's AI allowance, and fires `ai_usage` so
 * spend can be summed per feature and per model. A model the public catalog does not price
 * costs nothing and reports `cost_usd` as null.
 */
export async function trackAiUsage({
  userId,
  feature,
  aiClient,
  usage,
}: {
  userId: number;
  feature: AI_FEATURE | 'budget_suggestions';
  aiClient: { provider: AI_PROVIDER; modelId: string; usingUserKey: boolean };
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
}): Promise<void> {
  if (aiClient.usingUserKey && !process.env.POSTHOG_KEY) return;

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;

  const { pricing } = await getModelProfile({
    provider: aiClient.provider,
    model: getModelNameFromModelId({ modelId: aiClient.modelId }),
  });
  const costUsd = pricing
    ? (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000
    : null;

  if (!aiClient.usingUserKey) {
    // An unpriced server model leaves the AI cap unenforced, so it must not pass quietly.
    if (costUsd === null) {
      logger.error('Server AI call has no catalog price, not counted toward the AI cap', {
        userId,
        feature,
        provider: aiClient.provider,
        modelId: aiClient.modelId,
      });
    } else {
      await recordAiSpend({ userId, costUsd });
    }
  }

  if (!process.env.POSTHOG_KEY) return;

  trackEvent({
    userId,
    event: 'ai_usage',
    properties: {
      feature,
      provider: aiClient.provider,
      model_id: aiClient.modelId,
      using_user_key: aiClient.usingUserKey,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    },
  });
}
