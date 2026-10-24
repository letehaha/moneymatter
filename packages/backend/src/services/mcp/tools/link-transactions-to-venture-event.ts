import { recordId } from '@common/lib/zod/custom-types';
import { appendLinksBodySchema } from '@controllers/venture/events/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeVentureEventLink } from '@root/serializers';
import { linkTxsToEvent } from '@services/venture/linking/link-txs-to-event.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  eventId: recordId().describe('Venture event ID (from list_venture_events)'),
  transactionIds: appendLinksBodySchema.shape.transactionIds.describe(
    'IDs of the bank transactions to link (from search_transactions), at least one',
  ),
};

export function registerLinkTransactionsToVentureEvent(server: McpServer) {
  server.registerTool(
    'link_transactions_to_venture_event',
    {
      description:
        "Link existing bank transactions to a venture event as the cash behind it. The rules: every transaction is in the same currency as the event, none is already linked to a venture event or a portfolio, or part of a transfer, and the sum of their amounts equals the event's lpNetAmount exactly; otherwise nothing is linked. The transactions are marked as transfers to venture; delete_venture_event_link restores one. Returns the links created. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'link_transactions_to_venture_event', clientId: extra.authInfo?.clientId });

      const links = await linkTxsToEvent({
        userId,
        eventId: args.eventId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: links.map(serializeVentureEventLink) });
    },
  );
}
