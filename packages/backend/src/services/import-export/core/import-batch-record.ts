import type { RecordId, TransactionImportDetails } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import { withTransaction } from '@services/common/with-transaction';

interface OpenImportBatchParams {
  userId: number;
  importDetails: TransactionImportDetails;
  createdAccountIds?: string[];
}

/** Returns the `ImportBatches.id` of the new row. */
export type OpenImportBatch = (params: OpenImportBatchParams) => Promise<RecordId>;

const createImportBatchRecord = withTransaction(
  async ({ userId, importDetails, createdAccountIds = [] }: OpenImportBatchParams): Promise<RecordId> => {
    const batch = await ImportBatches.create({
      userId,
      batchId: importDetails.batchId,
      source: importDetails.source,
      importedAt: new Date(importDetails.importedAt),
    });
    await ImportBatchAccountEffects.bulkCreate(
      createdAccountIds.map((accountId) => ({ importBatchId: batch.id, accountId, createdByImport: true })),
    );
    return batch.id;
  },
);

const markImportBatchFinished = withTransaction(async ({ importBatchId }: { importBatchId: RecordId }) => {
  await ImportBatches.update({ finishedAt: new Date() }, { where: { id: importBatchId } });
});

/**
 * Hands an importer `openImportBatch` and stamps `finishedAt` once the importer
 * returns or throws. The importer must call `openImportBatch` right after its
 * accounts exist, before any later step that can fail: an account created with
 * no batch row cannot be undone. An importer that creates no accounts calls it
 * before its row loop.
 */
export function withImportBatchRecord<P extends { openImportBatch: OpenImportBatch }, R>(
  importer: (params: P) => Promise<R>,
) {
  return async (params: Omit<P, 'openImportBatch'>): Promise<R> => {
    let opened: { importBatchId: RecordId; userId: number; batchId: string } | undefined;
    try {
      return await importer({
        ...params,
        openImportBatch: async (batch) => {
          const importBatchId = await createImportBatchRecord(batch);
          opened = { importBatchId, userId: batch.userId, batchId: batch.importDetails.batchId };
          return importBatchId;
        },
      } as P);
    } finally {
      if (opened) {
        // Never rethrow: the rows are committed, and an unset `finishedAt` only
        // delays undo until the unfinished-import cutoff passes.
        await markImportBatchFinished({ importBatchId: opened.importBatchId }).catch((err) =>
          logger.error(
            { message: '[import batch] Failed to set finishedAt', error: err as Error },
            { code: 'IMPORT_BATCH_FINISH_FAILED', ...opened },
          ),
        );
      }
    }
  };
}
