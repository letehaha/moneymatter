import { t } from '@i18n/index';
import { LockedError } from '@js/errors';
import ImportBatches from '@models/import-batches.model';
import { Op } from 'sequelize';

// ponytail: age heuristic, not a liveness check. A crashed import worker blocks its user until
// BullMQ fails the stalled job or this passes. Store the BullMQ job id on the batch row and ask
// the queue instead if that ever hurts.
const UNFINISHED_IMPORT_BLOCK_MS = 3 * 60 * 60 * 1000;

export const isImportBatchUnfinished = ({ batch }: { batch: Pick<ImportBatches, 'finishedAt' | 'importedAt'> }) =>
  !batch.finishedAt && Date.now() - batch.importedAt.getTime() < UNFINISHED_IMPORT_BLOCK_MS;

/** An import still writing rows would land them across the link change and corrupt its balance absorb. */
export const assertNoUnfinishedImport = async ({ userId }: { userId: number }): Promise<void> => {
  const running = await ImportBatches.findOne({
    where: {
      userId,
      finishedAt: null,
      importedAt: { [Op.gt]: new Date(Date.now() - UNFINISHED_IMPORT_BLOCK_MS) },
    },
    attributes: ['id'],
  });

  if (running) throw new LockedError({ message: t({ key: 'accounts.bankLinkImportStillRunning' }) });
};
