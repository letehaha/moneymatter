import { isTwoLegTransfer } from '@bt/shared/types';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import * as Transactions from '@models/transactions.model';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  keepVisibleRows,
  loadTransferTwins,
  TRANSACTION_SAMPLE_ATTRIBUTES,
  targetNotFound,
  transactionsAffected,
  withTwinsAfterTheirLeg,
} from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * Undoing an import deletes every transaction the batch stamped (the same set the service reads),
 * reverses the balance the import absorbed and removes the accounts it created. The other leg of a
 * transfer that lies outside the batch is deleted only with `deleteLinkedTransfers`, and unlinked
 * otherwise. The card counts every such leg, shows the ones on accounts the user can see, and
 * snapshots all of them.
 */
export const resolveDeleteImportBatch: PreviewResolver = async ({ userId, args }) => {
  const batchId = args.batchId as string;

  const batch = await ImportBatches.findOne({ where: { userId, batchId } });
  const effects = batch ? await ImportBatchAccountEffects.findAll({ where: { importBatchId: batch.id } }) : [];

  const rows = await Transactions.findWithFilters({
    planned: 'exclude',
    access: { creator: userId },
    completeness: 'all',
    balanceAdjustments: 'include',
    batchId: batch?.batchId ?? batchId,
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
  });
  if (rows.length === 0 && !batch) throw targetNotFound({ what: 'import batch' });

  // The service finds the other leg of each two-leg transfer by `transferId` alone, whoever created it.
  const outside = await loadTransferTwins({
    rows,
    legs: rows.filter((row) => isTwoLegTransfer(row.transferNature)),
  });
  const deletesOutside = args.deleteLinkedTransfers === true;
  const total = rows.length + (deletesOutside ? outside.length : 0);

  const warnings = [
    ...(batch && !batch.finishedAt ? [{ key: 'chat.warnings.importRunning' }] : []),
    ...(deletesOutside && outside.length > 0
      ? [{ key: 'chat.warnings.linkedTransfers', params: { count: outside.length } }]
      : []),
  ];

  return {
    preview: {
      affected: transactionsAffected({
        rows: await keepVisibleRows({
          userId,
          rows: deletesOutside ? withTwinsAfterTheirLeg({ rows, twins: outside }) : rows,
        }),
        count: total,
      }),
      counts: {
        transactionCount: rows.length,
        createdAccountCount: effects.filter((effect) => effect.createdByImport).length,
        balanceReversalCount: effects.filter((effect) => !effect.absorbedAmount.isZero()).length,
      },
    },
    // An outside leg is in the snapshot whether the undo deletes or unlinks it, so one linked later
    // makes the card stale.
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [...rows, ...outside].map((row) => row.updatedAt) }),
      targetHash: hashTargetIds({ ids: [...rows, ...outside].map((row) => row.id) }),
      targetCount: rows.length + outside.length,
    },
    affectedCount: total,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
