import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTransactionGroups } from '@services/transaction-groups';
import type {
  TransactionGroupWithAggregates,
  TransactionGroupWithTransactions,
} from '@services/transaction-groups/get-transaction-groups';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentTransactions } from './transaction-output';

const inputSchema = {
  includeTransactions: z
    .boolean()
    .optional()
    .describe('When true, embed full transaction data in each group. Default: false (aggregates only)'),
};

export function registerGetTransactionGroups(server: McpServer) {
  server.registerTool(
    'get_transaction_groups',
    {
      description:
        'List all transaction groups for the user. Groups bundle related transactions (e.g. split expenses). When includeTransactions is true, each group contains the full transaction list, each with its payee; otherwise returns aggregate counts and date ranges.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_transaction_groups', clientId: extra.authInfo?.clientId });

      const result = await getTransactionGroups({ userId, includeTransactions: args.includeTransactions });

      if (args.includeTransactions) {
        const groups = result as TransactionGroupWithTransactions[];
        // Embedded transactions are full models; run through the REST serializer
        // (Money → decimals) then keep only the AI-relevant fields. One call presents every
        // group's transactions, so the payee names come from a single lookup.
        const presented = await presentTransactions({
          userId,
          transactions: serializeTransactions(groups.flatMap((group) => group.transactions)),
        });
        let offset = 0;
        const slimmed = groups.map((group) => {
          const transactions = presented.slice(offset, offset + group.transactions.length);
          offset += group.transactions.length;
          return { id: group.id, name: group.name, note: group.note, transactions };
        });

        return jsonContent({ data: slimmed });
      }

      const groups = result as TransactionGroupWithAggregates[];
      const slimmed = groups.map((group) => ({
        id: group.id,
        name: group.name,
        note: group.note,
        transactionCount: group.transactionCount,
        dateFrom: group.dateFrom,
        dateTo: group.dateTo,
      }));

      return jsonContent({ data: slimmed });
    },
  );
}
