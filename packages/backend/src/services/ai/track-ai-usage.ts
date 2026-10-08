import { type AI_FEATURE, type AI_PROVIDER, getModelNameFromModelId } from '@bt/shared/types';
import { trackEvent } from '@js/utils/posthog';

import { getModelProfile } from './model-catalog';

/**
 * Fired once per answered AI call, so spend can be summed per feature and per model.
 * `cost_usd` is null for a model the public catalog does not price.
 */
export function trackAiUsage({
  userId,
  feature,
  aiClient,
  usage,
}: {
  userId: string | number;
  feature: AI_FEATURE;
  aiClient: { provider: AI_PROVIDER; modelId: string; usingUserKey: boolean };
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
}): void {
  if (!process.env.POSTHOG_KEY) return;

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;

  void getModelProfile({
    provider: aiClient.provider,
    model: getModelNameFromModelId({ modelId: aiClient.modelId }),
  }).then(({ pricing }) =>
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
        cost_usd: pricing
          ? (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000
          : null,
      },
    }),
  );
}
