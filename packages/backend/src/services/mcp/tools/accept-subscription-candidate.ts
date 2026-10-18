import { recordId } from '@common/lib/zod/custom-types';
import { acceptCandidateBodySchema } from '@controllers/subscriptions/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveCandidate } from '@services/subscriptions/resolve-candidate';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  candidateId: recordId().describe('ID of the pending subscription candidate (from list_subscription_candidates)'),
  subscriptionId: acceptCandidateBodySchema.shape.subscriptionId.describe(
    'ID of an existing subscription to attach the candidate to: the candidate’s sample transactions that still exist and are not linked yet get linked to it. Omit to just mark the candidate accepted',
  ),
};

export function registerAcceptSubscriptionCandidate(server: McpServer) {
  server.registerTool(
    'accept_subscription_candidate',
    {
      description:
        'Accept a pending subscription candidate. With subscriptionId, its sample transactions that still exist are linked to that subscription; without it, the candidate is only marked accepted (create the subscription with create_subscription). Only pending candidates can be accepted. Returns { id, status }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'accept_subscription_candidate', clientId: extra.authInfo?.clientId });

      const result = await resolveCandidate({
        userId,
        candidateId: args.candidateId,
        subscriptionId: args.subscriptionId,
      });

      return jsonContent({ data: result });
    },
  );
}
