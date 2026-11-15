import { isTwoLegTransfer } from '@bt/shared/types';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import { findTransactions } from '@models/transactions-query';
import { trashedWhere } from '@models/transactions-query/deletion-where';
import * as Transactions from '@models/transactions.model';
import { literal, Op, where as sequelizeWhere } from 'sequelize';

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
 * The rows of the batch that sit in Trash, and with `withTwinsOf` the trashed other legs of their
 * transfers outside the batch, read as the service reads them: an undo deletes them for good.
 */
const loadTrashed = async ({ userId, batchId }: { userId: number; batchId: string }) => {
  const rows = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    completeness: 'all',
    balanceAdjustments: 'include',
    paranoid: false,
    where: {
      ...trashedWhere,
      [Op.and]: [sequelizeWhere(literal(`"Transactions"."externalData"->'importDetails'->>'batchId'`), batchId)],
    },
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
  });

  // Pairs go to Trash together, so the other leg of a trashed row is a trashed row too.
  const transferIds = [
    ...new Set(rows.flatMap((row) => (isTwoLegTransfer(row.transferNature) && row.transferId ? [row.transferId] : []))),
  ];
  const outside =
    transferIds.length === 0
      ? []
      : await findTransactions({
          planned: 'include',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          completeness: 'all',
          paranoid: false,
          where: { ...trashedWhere, transferId: transferIds, id: { [Op.notIn]: rows.map((row) => row.id) } },
          attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
        });

  return { rows, outside };
};

/**
 * Undoing an import deletes every transaction the batch stamped (the same set the service reads),
 * reverses the balance the import absorbed and removes the accounts it created. Rows of the batch
 * that sit in Trash are deleted for good as well. The other leg of a transfer that lies outside the
 * batch is deleted only with `deleteLinkedTransfers`, and unlinked otherwise. The card counts every
 * such leg, shows the ones on accounts the user can see, and snapshots all of them.
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
  const trashed = await loadTrashed({ userId, batchId: batch?.batchId ?? batchId });
  if (rows.length === 0 && trashed.rows.length === 0 && !batch) throw targetNotFound({ what: 'import batch' });

  // The service finds the other leg of each two-leg transfer by `transferId` alone, whoever created it.
  const outside = await loadTransferTwins({
    rows,
    legs: rows.filter((row) => isTwoLegTransfer(row.transferNature)),
  });
  const deletesOutside = args.deleteLinkedTransfers === true;
  const trashedTotal = trashed.rows.length + (deletesOutside ? trashed.outside.length : 0);
  const total = rows.length + (deletesOutside ? outside.length : 0) + trashedTotal;
  const snapshotRows = [...rows, ...outside, ...trashed.rows, ...trashed.outside];

  const warnings = [
    ...(batch && !batch.finishedAt ? [{ key: 'chat.warnings.importRunning' }] : []),
    ...(deletesOutside && outside.length > 0
      ? [{ key: 'chat.warnings.linkedTransfers', params: { count: outside.length } }]
      : []),
    ...(trashedTotal > 0 ? [{ key: 'chat.warnings.trashedRowsDeleted', params: { count: trashedTotal } }] : []),
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
        trashedTransactionCount: trashedTotal,
        createdAccountCount: effects.filter((effect) => effect.createdByImport).length,
        balanceReversalCount: effects.filter((effect) => !effect.absorbedAmount.isZero()).length,
      },
    },
    // An outside leg is in the snapshot whether the undo deletes or unlinks it, so one linked later
    // makes the card stale.
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: snapshotRows.map((row) => row.updatedAt) }),
      targetHash: hashTargetIds({ ids: snapshotRows.map((row) => row.id) }),
      targetCount: snapshotRows.length,
    },
    affectedCount: total,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
