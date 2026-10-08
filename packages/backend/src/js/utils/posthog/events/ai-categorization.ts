import type { AI_PROVIDER } from '@bt/shared/types';

import { trackEvent } from '../index';

/**
 * Track AI categorization completion.
 */
export function trackAiCategorization({
  userId,
  categorizedCount,
  failedCount,
  provider,
  modelId,
  usingUserKey,
  sessionId,
}: {
  userId: string | number;
  categorizedCount: number;
  failedCount: number;
  provider: AI_PROVIDER;
  modelId: string;
  usingUserKey: boolean;
  sessionId?: string | null;
}): void {
  trackEvent({
    userId,
    event: 'ai_categorization_completed',
    properties: {
      categorized_count: categorizedCount,
      failed_count: failedCount,
      provider,
      model_id: modelId,
      using_user_key: usingUserKey,
    },
    sessionId,
  });
}
