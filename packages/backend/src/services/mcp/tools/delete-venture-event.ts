import { recordId } from '@common/lib/zod/custom-types';
import { deleteVentureEvent } from '@services/venture/events/delete.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteVentureEventTool = defineTool({
  name: 'delete_venture_event',
  toolset: 'ventures',
  access: 'delete',
  description:
    'Delete a venture event. Linked bank transactions are unlinked first (their original state is restored). The initial_investment cannot be deleted while other events still exist on the deal — delete the other events first. Pass deleteLinkedTransactions=true to also remove the bank tx rows themselves (not just the link); only do this when the user explicitly asks. Confirm with the user before calling.',
  input: {
    eventId: recordId().describe('Venture event ID (from list_venture_events)'),
    deleteLinkedTransactions: z
      .boolean()
      .optional()
      .describe('If true, also delete the bank transaction rows that were linked. Default: false (unlink only).'),
  },
  run: ({ userId, args }) =>
    deleteVentureEvent({
      userId,
      eventId: args.eventId,
      deleteLinkedTransactions: args.deleteLinkedTransactions,
    }),
});
