import { recordId } from '@common/lib/zod/custom-types';
import { deleteVentureDeal } from '@services/venture/deals/delete.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteVentureDealTool = defineTool({
  name: 'delete_venture_deal',
  toolset: 'ventures',
  access: 'delete',
  description:
    "Delete a venture deal. Cascade-deletes its events and event-link rows. Bank transactions previously linked to the deal's events remain intact in the main transactions list with their original state restored. With force=true the deal row is hard-deleted; otherwise it is soft-deleted. Confirm with the user before calling.",
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
    force: z.boolean().optional().describe('If true, hard-delete the deal row. Default: false (soft-delete).'),
  },
  run: ({ userId, args }) =>
    deleteVentureDeal({
      userId,
      dealId: args.dealId,
      force: args.force,
    }),
});
