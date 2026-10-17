import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { positiveAmountSchema } from '@controllers/transactions.controller/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTransactionById } from '@services/transactions/get-by-id';
import { manageSplits } from '@services/transactions/splits/manage-splits';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of the transaction to split'),
  splits: z
    .array(
      z.object({
        categoryId: recordId().describe('Category ID for this split portion'),
        amount: positiveAmountSchema().describe('Amount for this split portion (decimal, greater than 0)'),
        note: z.string().optional().nullable().describe('Optional note for this split'),
      }),
    )
    .min(1)
    .describe('Split portions — amounts must sum to the full transaction amount'),
};

export function registerSplitTransaction(server: McpServer) {
  server.registerTool(
    'split_transaction',
    {
      description:
        'Split a transaction across multiple categories. Provide the transactionId and an array of splits whose amounts sum to the transaction total. Replaces any existing splits on the transaction.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'split_transaction', clientId: extra.authInfo?.clientId });

      const fetched = await getTransactionById({
        id: args.transactionId,
        userId,
        requiredPermission: SHARE_PERMISSIONS.write,
      });
      if (!fetched) {
        throw new Error(`Transaction ${args.transactionId} not found`);
      }
      const transaction = fetched.tx;

      const result = await manageSplits({
        transactionId: args.transactionId,
        userId,
        categoryOwnerUserId: fetched.access.ownerUserId,
        splits: args.splits.map((s) => ({
          categoryId: s.categoryId,
          amount: Money.fromDecimal(s.amount),
          note: s.note,
        })),
        transactionAmount: transaction.amount,
        transactionCurrencyCode: transaction.currencyCode,
        transactionTime: transaction.time,
        transferNature: transaction.transferNature,
      });

      return jsonContent({
        data: result.map((split) => ({
          id: split.id,
          transactionId: split.transactionId,
          categoryId: split.categoryId,
          amount: split.amount.toNumber(),
          refAmount: split.refAmount?.toNumber() ?? null,
          note: split.note,
        })),
      });
    },
  );
}
