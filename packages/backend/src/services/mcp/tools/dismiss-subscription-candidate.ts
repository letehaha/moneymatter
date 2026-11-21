import { dismissCandidate } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const dismissSubscriptionCandidateTool = defineTool({
  name: 'dismiss_subscription_candidate',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Dismiss a pending subscription candidate so it no longer appears in the candidate list. The underlying transactions are unaffected. Only pending candidates can be dismissed.',
  input: {
    candidateId: z.string().describe('UUID of the subscription candidate to dismiss'),
  },
  run: ({ userId, args }) => dismissCandidate({ userId, candidateId: args.candidateId }),
});
