import { recordId } from '@common/lib/zod/custom-types';
import { acceptCandidateBodySchema } from '@controllers/subscriptions/shared-schemas';
import { resolveCandidate } from '@services/subscriptions/resolve-candidate';

import { defineTool } from '../define-tool';

export const acceptSubscriptionCandidateTool = defineTool({
  name: 'accept_subscription_candidate',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Accept a pending subscription candidate. With subscriptionId, its sample transactions that still exist are linked to that subscription; without it, the candidate is only marked accepted (create the subscription with create_subscription). Only pending candidates can be accepted. Returns { id, status }.',
  input: {
    candidateId: recordId().describe('ID of the pending subscription candidate (from list_subscription_candidates)'),
    subscriptionId: acceptCandidateBodySchema.shape.subscriptionId.describe(
      'ID of an existing subscription to attach the candidate to: the candidate’s sample transactions that still exist and are not linked yet get linked to it. Omit to just mark the candidate accepted',
    ),
  },
  run: ({ userId, args }) =>
    resolveCandidate({
      userId,
      candidateId: args.candidateId,
      subscriptionId: args.subscriptionId,
    }),
});
