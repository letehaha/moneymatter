import { recordId } from '@common/lib/zod/custom-types';
import { deleteOrQueueImportBatch } from '@services/import-export/delete-or-queue-batch.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteImportBatchTool = defineTool({
  name: 'delete_import_batch',
  toolset: 'imports',
  access: 'delete',
  description:
    'Undo an import: permanently delete every transaction the batch created, reverse the balance shift the import absorbed, and remove accounts the import created once they are empty. Irreversible: call list_import_batches first and check transactionCount. A batch of up to 1000 rows is deleted at once and returns { queued: false, deletedCount }. A larger batch runs as a background job and returns { queued: true, jobId }; follow it with get_import_batch_delete_status. While that job runs, writes are blocked. Refused when the batch touches an account that is now bank-connected, or while its import is still running.',
  input: {
    batchId: recordId().describe('The batchId of the import to undo, from list_import_batches.'),
    deleteLinkedTransfers: z
      .boolean()
      .optional()
      .describe(
        'Also delete the other leg of a transfer when it lies outside the batch (a transaction that existed before the import). Default false: the batch leg is then unlinked and the outside transaction stays.',
      ),
  },
  run: async ({ userId, args }) => {
    const result = await deleteOrQueueImportBatch({
      userId,
      batchId: args.batchId,
      deleteLinkedTransfers: args.deleteLinkedTransfers ?? false,
    });

    if ('jobId' in result) {
      return {
        queued: true,
        jobId: result.jobId,
        message:
          'The batch is above the inline limit and is deleting in the background. Follow it with get_import_batch_delete_status.',
      };
    }

    return { queued: false, deletedCount: result.deletedCount };
  },
});
