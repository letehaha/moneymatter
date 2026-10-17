import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSingleRefund } from '@services/tx-refunds/create-single-refund.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  originalTxId: z
    .string()
    .uuid()
    .nullable()
    .describe('ID of the original transaction being refunded. Pass null for a standalone refund'),
  refundTxId: recordId().describe('ID of the transaction that represents the refund'),
  splitId: z.string().optional().describe('UUID of a specific split on the original transaction this refund targets'),
};

export function registerLinkRefund(server: McpServer) {
  server.registerTool(
    'link_refund',
    {
      description:
        'Mark an existing transaction as a refund of another transaction. Provide originalTxId (the transaction being refunded) and refundTxId (the refund transaction). The two transactions must have opposite types (income vs expense). Optionally target a specific split of the original.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'link_refund', clientId: extra.authInfo?.clientId });

      const result = await createSingleRefund({
        userId,
        originalTxId: args.originalTxId,
        refundTxId: args.refundTxId,
        splitId: args.splitId,
      });

      return jsonContent({
        data: {
          id: result.id,
          originalTxId: result.originalTxId,
          refundTxId: result.refundTxId,
          splitId: result.splitId,
        },
      });
    },
  );
}
