import { SUBSCRIPTION_CANDIDATE_STATUS } from '@bt/shared/types';
import { getCandidates } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const listSubscriptionCandidatesTool = defineTool({
  name: 'list_subscription_candidates',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'List auto-detected subscription candidates sorted by confidence score. Call detect_subscription_candidates first to generate fresh candidates. Use status filter to see only pending, accepted, or dismissed candidates.',
  input: {
    status: z
      .enum([
        SUBSCRIPTION_CANDIDATE_STATUS.pending,
        SUBSCRIPTION_CANDIDATE_STATUS.accepted,
        SUBSCRIPTION_CANDIDATE_STATUS.dismissed,
      ])
      .optional()
      .describe('Filter by candidate status. Omit to return all statuses'),
  },
  run: ({ userId, args }) => getCandidates({ userId, status: args.status }),
});
