import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransaction, serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTransactionById } from '@services/transactions/get-by-id';
import { getTransactionsByIds } from '@services/transactions/get-by-ids';
import { getTransactionsByTransferId } from '@services/transactions/get-by-transfer-id';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentTransactions } from './transaction-output';

/** The by-ids service refuses more than this many ids at once (`MAX_IDS`). */
const MAX_IDS = 50;

const inputSchema = {
  ids: z
    .array(recordId())
    .min(1)
    .max(MAX_IDS)
    .optional()
    .describe(`IDs of the transactions to read (1 to ${MAX_IDS}). Give this or transferId, not both`),
  transferId: z
    .string()
    .optional()
    .describe('Read both legs of a transfer by their shared transferId. Give this or ids, not both'),
  includeSplits: z
    .boolean()
    .optional()
    .describe("Include each transaction's splits (category, amount, note) and tags. Costs one read per transaction"),
};

export function registerGetTransactions(server: McpServer) {
  server.registerTool(
    'get_transactions',
    {
      description:
        'Read transactions by id (up to 50) or both legs of a transfer by transferId. Returns the same fields as search_transactions: amount (original + base currency), category, account, payee, note, date, type and planned state. Set includeSplits to also get splits and tags. An id the caller cannot see is left out.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_transactions', clientId: extra.authInfo?.clientId });

      if ((args.ids === undefined) === (args.transferId === undefined)) {
        throw new Error('Provide exactly one of "ids" and "transferId"');
      }

      // The list reads carry no splits or tags; the by-id read does, so a caller that wants them
      // reads each transaction through it. An id the caller cannot see comes back as `null`.
      const readWithSplits = async ({ ids }: { ids: string[] }) =>
        (
          await Promise.all(
            ids.map(async (id) => {
              const fetched = await getTransactionById({ id, userId, includeSplits: true, includeTags: true });
              return fetched ? serializeTransaction(fetched.tx) : null;
            }),
          )
        ).filter((tx) => tx !== null);

      let transactions;
      if (args.ids) {
        transactions = args.includeSplits
          ? await readWithSplits({ ids: args.ids })
          : await getTransactionsByIds({ userId, ids: args.ids });
      } else {
        const legs = serializeTransactions(await getTransactionsByTransferId({ transferId: args.transferId!, userId }));
        transactions = args.includeSplits ? await readWithSplits({ ids: legs.map((leg) => leg.id) }) : legs;
      }

      return jsonContent({ data: { transactions: await presentTransactions({ userId, transactions }) } });
    },
  );
}
