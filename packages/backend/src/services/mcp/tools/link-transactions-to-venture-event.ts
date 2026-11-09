import { recordId } from '@common/lib/zod/custom-types';
import { appendLinksBodySchema } from '@controllers/venture/events/schemas';
import { serializeVentureEventLink } from '@root/serializers';
import { linkTxsToEvent } from '@services/venture/linking/link-txs-to-event.service';

import { defineTool } from '../define-tool';

export const linkTransactionsToVentureEventTool = defineTool({
  name: 'link_transactions_to_venture_event',
  toolset: 'ventures',
  access: 'write',
  description:
    "Link existing bank transactions to a venture event as the cash behind it. The rules: every transaction is in the same currency as the event, none is already linked to a venture event or a portfolio, or part of a transfer; otherwise nothing is linked. The amounts may differ from the event's lpNetAmount: the event records what the statement says, the transactions what reached the bank (transfer fees, FX spreads). The transactions are marked as transfers to venture; delete_venture_event_link restores one. Returns the links created.",
  input: {
    eventId: recordId().describe('Venture event ID (from list_venture_events)'),
    transactionIds: appendLinksBodySchema.shape.transactionIds.describe(
      'IDs of the bank transactions to link (from search_transactions), at least one',
    ),
  },
  run: async ({ userId, args }) => {
    const links = await linkTxsToEvent({
      userId,
      eventId: args.eventId,
      transactionIds: args.transactionIds,
    });

    return links.map(serializeVentureEventLink);
  },
});
