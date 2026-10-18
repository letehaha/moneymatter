import { TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeRefundTransactions } from '@root/serializers/refund-transactions.serializer';
import { getRefundsForTransactionById } from '@services/tx-refunds/get-refund-for-transaction-by-id.service';
import { getRefund } from '@services/tx-refunds/get-refund.service';
import { getRefundTransactions } from '@services/tx-refunds/get-refunds.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentRefunds } from './refund-output';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const inputSchema = {
  transactionId: recordId()
    .optional()
    .describe('Mode 1: every refund link that has this transaction as the original or as the refund'),
  originalTxId: recordId().optional().describe('Mode 2: with refundTxId, read the one refund link between the two'),
  refundTxId: recordId().optional().describe('Mode 2: with originalTxId, read the one refund link between the two'),
  page: z.number().int().positive().optional().describe(`Mode 3: page number, from 1 (default 1)`),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`Mode 3: refund links per page, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
  categoryId: recordId().optional().describe('Mode 3: only refunds whose original transaction is in this category'),
  accountId: recordId().optional().describe('Mode 3: only refunds whose original transaction is on this account'),
  transactionType: z
    .nativeEnum(TRANSACTION_TYPES)
    .optional()
    .describe('Mode 3: only refunds whose original transaction is of this type'),
};

export function registerGetRefunds(server: McpServer) {
  server.registerTool(
    'get_refunds',
    {
      description:
        'Read refund links, the pairs of an original transaction and the transaction that refunds it. Three modes: give transactionId for the refunds of one transaction; give originalTxId and refundTxId for one link; give neither (optionally page, limit, categoryId, accountId, transactionType) to list all of them, newest page first. Each link carries both transactions with their payee. Returns { refunds } and, in list mode, { meta: { total, page, limit } }. To find rows a refund could link to, use get_refund_recommendations.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_refunds', clientId: extra.authInfo?.clientId });

      const { transactionId, originalTxId, refundTxId, ...listArgs } = args;
      const hasPairId = originalTxId !== undefined || refundTxId !== undefined;
      const hasListArgs = Object.values(listArgs).some((value) => value !== undefined);

      if (transactionId !== undefined && (hasPairId || hasListArgs)) {
        throw new Error('"transactionId" cannot be combined with originalTxId, refundTxId, page, limit or filters');
      }
      if ((originalTxId === undefined) !== (refundTxId === undefined)) {
        throw new Error('"originalTxId" and "refundTxId" must be given together');
      }
      if (hasPairId && hasListArgs) {
        throw new Error('"originalTxId" and "refundTxId" cannot be combined with page, limit or filters');
      }

      if (transactionId !== undefined) {
        const refunds = await getRefundsForTransactionById({ userId, transactionId });
        return jsonContent({
          data: { refunds: await presentRefunds({ userId, refunds: serializeRefundTransactions(refunds) }) },
        });
      }

      if (originalTxId !== undefined && refundTxId !== undefined) {
        const refund = await getRefund({ userId, originalTxId, refundTxId });
        return jsonContent({
          data: { refunds: await presentRefunds({ userId, refunds: serializeRefundTransactions([refund]) }) },
        });
      }

      const { rows, meta } = await getRefundTransactions({
        userId,
        page: listArgs.page ?? 1,
        limit: listArgs.limit ?? DEFAULT_LIMIT,
        ...(listArgs.categoryId && { categoryId: listArgs.categoryId }),
        ...(listArgs.accountId && { accountId: listArgs.accountId }),
        ...(listArgs.transactionType && { transactionType: listArgs.transactionType }),
      });

      return jsonContent({
        data: { refunds: await presentRefunds({ userId, refunds: serializeRefundTransactions(rows) }), meta },
      });
    },
  );
}
