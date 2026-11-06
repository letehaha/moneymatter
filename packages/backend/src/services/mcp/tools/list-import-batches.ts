import { listBatchesHistory } from '@services/import-export/get-batches-history.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentImportBatch } from './import-batch-output';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export const listImportBatchesTool = defineTool({
  name: 'list_import_batches',
  toolset: 'imports',
  access: 'read',
  description: `List the import batches of the signed-in user, newest first: every CSV, YNAB, statement, Wallet, MS Money and OFX import that still has transactions to undo. Each has batchId, source, importedAt, transactionCount, accountIds and createdAccountCount (accounts the import created). Returns { batches, total }; total is the number of batches and is only filled when offset is 0 (null on later pages). Pass a batchId to delete_import_batch to undo that import. Importing itself is done in the app.`,
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`How many batches to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('How many batches to skip, for the next page (default 0)'),
  },
  run: async ({ userId, args }) => {
    const history = await listBatchesHistory({
      userId,
      limit: args.limit ?? DEFAULT_LIMIT,
      offset: args.offset ?? 0,
    });

    return { batches: history.items.map((batch) => presentImportBatch({ batch })), total: history.totalCount };
  },
});
