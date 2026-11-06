import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRefundsForTransactionById } from '@services/tx-refunds/get-refund-for-transaction-by-id.service';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of a transaction on either side of the links (the refund or the original)'),
};

export function registerGetRefundLinks(server: McpServer) {
  server.registerTool(
    'get_refund_links',
    {
      description:
        "List every refund link touching a transaction, on either side (as the refund or as the original). Each link has refundTxId, originalTxId (null for a purchase outside the app), splitId, and amount: the share of the refund transaction's amount in the refund's currency; null means the whole refund.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_refund_links', clientId: extra.authInfo?.clientId });

      const links = await getRefundsForTransactionById({ userId, transactionId: args.transactionId });

      return jsonContent({
        data: links.map((l) => ({
          refundTxId: l.refundTxId,
          originalTxId: l.originalTxId,
          splitId: l.splitId,
          amount: l.amount ? l.amount.toNumber() : null,
        })),
      });
    },
  );
}
