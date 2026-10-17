import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeRefundLink } from '@services/tx-refunds/remove-refund-link.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  originalTxId: z
    .string()
    .uuid()
    .nullable()
    .describe('ID of the original transaction. Pass null if no original was set'),
  refundTxId: recordId().describe('ID of the refund transaction'),
};

export function registerUnlinkRefund(server: McpServer) {
  server.registerTool(
    'unlink_refund',
    {
      description:
        'Remove the refund link between two transactions. DESTRUCTIVE: both transactions will no longer be marked as refund-linked. Requires both originalTxId and refundTxId that were previously linked.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unlink_refund', clientId: extra.authInfo?.clientId });

      await removeRefundLink({
        userId,
        originalTxId: args.originalTxId,
        refundTxId: args.refundTxId,
      });

      return jsonContent({ data: { unlinked: true, originalTxId: args.originalTxId, refundTxId: args.refundTxId } });
    },
  );
}
