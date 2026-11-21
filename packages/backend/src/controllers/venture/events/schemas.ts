import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Body of `POST /venture/events/:id/links`; the MCP `link_transactions_to_venture_event` tool reads its shape. */
export const appendLinksBodySchema = z.object({
  transactionIds: z.array(recordId()).min(1),
});

/** Body of `PUT /venture/events/:id/links`; the MCP `replace_venture_event_links` tool reads its shape. */
export const replaceLinksBodySchema = z.object({
  transactionIds: z.array(recordId()),
});
