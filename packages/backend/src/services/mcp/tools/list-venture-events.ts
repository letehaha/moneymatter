import { recordId } from '@common/lib/zod/custom-types';
import { listVentureEvents } from '@services/venture/events/list.service';

import { defineTool } from '../define-tool';

export const listVentureEventsTool = defineTool({
  name: 'list_venture_events',
  toolset: 'ventures',
  access: 'read',
  description:
    'List events for a venture deal in chronological order (oldest first). Each event has a type (initial_investment | capital_call | distribution | nav_update | exit | writedown | fee_payment), date, amounts, cashFlowMode, and embedded link rows (when the event is tied to bank transactions). Use the returned event ids with get_venture_event, update_venture_event, and delete_venture_event.',
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
  },
  run: ({ userId, args }) => listVentureEvents({ userId, dealId: args.dealId }),
});
