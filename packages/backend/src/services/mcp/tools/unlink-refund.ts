import { recordId } from '@common/lib/zod/custom-types';
import { removeRefundLink } from '@services/tx-refunds/remove-refund-link.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const unlinkRefundTool = defineTool({
  name: 'unlink_refund',
  toolset: 'core',
  access: 'write',
  description:
    'Remove one refund link, identified by refundTxId + originalTxId; both transactions stay. Other links on either transaction keep their shares, and a transaction is unmarked as refund-linked only when it has no links left. The link can be recreated with link_refund.',
  input: {
    originalTxId: z
      .string()
      .uuid()
      .nullable()
      .describe('ID of the original transaction. Pass null if no original was set'),
    refundTxId: recordId().describe('ID of the refund transaction'),
  },
  run: async ({ userId, args }) => {
    await removeRefundLink({
      userId,
      originalTxId: args.originalTxId,
      refundTxId: args.refundTxId,
    });

    return { unlinked: true, originalTxId: args.originalTxId, refundTxId: args.refundTxId };
  },
});
