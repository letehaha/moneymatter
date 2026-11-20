import type { DeleteImportBatchResult } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteOrQueueImportBatch } from '@services/import-export/delete-or-queue-batch.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    batchId: recordId(),
  }),
  body: z
    .object({
      deleteLinkedTransfers: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Small batches delete inline and return the deleted ids. A batch above the sync
 * cap is handed to the background worker instead and answered 202 with its job id;
 * the client tracks it via GET /import/batch-delete/status.
 */
export const deleteBatchController = createController(schema, async ({ user, params, body }) => {
  const data: DeleteImportBatchResult = await deleteOrQueueImportBatch({
    userId: user.id,
    batchId: params.batchId,
    deleteLinkedTransfers: body?.deleteLinkedTransfers ?? false,
  });

  return 'jobId' in data ? { data, statusCode: 202 } : { data };
});
