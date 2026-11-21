import { detectCandidates } from '@services/subscriptions';

import { defineTool } from '../define-tool';

export const detectSubscriptionCandidatesTool = defineTool({
  name: 'detect_subscription_candidates',
  toolset: 'subscriptions',
  access: 'write',
  // GET /subscriptions/detect-candidates is a read in REST, so it carries no base-currency lock.
  lock: false,
  description:
    'Scan the past 12 months of transactions to detect recurring payment patterns and generate subscription candidates. This operation can be slow on large transaction histories. Results are cached for 1 hour — subsequent calls within the cooldown return cached candidates. Check isFromCache in the response to know if the data is fresh. It writes candidate records.',
  run: ({ userId }) => detectCandidates({ userId }),
});
