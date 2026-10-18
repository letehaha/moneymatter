import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listBatchesHistory } from '@services/import-export/get-batches-history.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentImportBatch } from './import-batch-output';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const inputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many batches to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
  offset: z.number().int().nonnegative().optional().describe('How many batches to skip, for the next page (default 0)'),
};

export function registerListImportBatches(server: McpServer) {
  server.registerTool(
    'list_import_batches',
    {
      description: `List the import batches of the signed-in user, newest first: every CSV, YNAB, statement, Wallet, MS Money and OFX import that still has transactions to undo. Each has batchId, source, importedAt, transactionCount, accountIds and createdAccountCount (accounts the import created). Returns { batches, total }; total is the number of batches and is only filled when offset is 0 (null on later pages). Pass a batchId to delete_import_batch to undo that import. Importing itself is done in the app.`,
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_import_batches', clientId: extra.authInfo?.clientId });

      const history = await listBatchesHistory({
        userId,
        limit: args.limit ?? DEFAULT_LIMIT,
        offset: args.offset ?? 0,
      });

      return jsonContent({
        data: { batches: history.items.map((batch) => presentImportBatch({ batch })), total: history.totalCount },
      });
    },
  );
}
