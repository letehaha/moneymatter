import {
  ACCOUNT_TYPES,
  type DeleteImportBatchResponse,
  TRANSACTION_TRANSFER_NATURE,
  isTwoLegTransfer,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { LockedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import { countTransactions, findTransactions, updateTransactions } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { deleteAccountById } from '@services/accounts.service';
import { absorbBalanceAdjustment } from '@services/accounts/absorb-balance-adjustment';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { withTransaction } from '@services/common/with-transaction';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { Op } from 'sequelize';

interface DeleteImportBatchParams {
  userId: number;
  batchId: string;
  /** Explicit opt-in to hard-delete a transfer's other leg when it lies outside the
   *  batch (a pre-existing manual transaction the import got linked to). Default
   *  `false` unlinks the batch's own leg to `transfer_out_wallet` instead, leaving the
   *  external transaction untouched. */
  deleteLinkedTransfers?: boolean;
  /** Rows above this count throw `ImportBatchTooLargeError` instead of deleting.
   *  The background worker passes `Infinity`. */
  maxRows?: number;
}

// Import batches can reach MAX_CSV_ROWS (50k) rows; bulkDelete's one-transaction,
// per-row loop would exceed the HTTP timeout at that scale, so larger batches run
// as a background job (see delete-batch-queue.ts).
const MAX_SYNC_BATCH_DELETE_TRANSACTIONS = 1000;

// ponytail: age heuristic, not a liveness check. A crashed import worker blocks undo
// of its batch until BullMQ fails the stalled job or this passes. Store the BullMQ job id on the batch row and ask
// the queue instead if that ever hurts.
const UNFINISHED_IMPORT_UNDO_BLOCK_MS = 3 * 60 * 60 * 1000;

export class ImportBatchTooLargeError extends Error {
  readonly rowCount: number;

  constructor({ rowCount }: { rowCount: number }) {
    super(`Import batch has ${rowCount} rows, above the synchronous cap`);
    this.rowCount = rowCount;
  }
}

/**
 * Resolves every row stamped with this batch's `importDetails.batchId`, scoped to the
 * caller, then delegates to `bulkDelete` — balance recalculation, transfer-pair handling,
 * and refund unlinking all come from that same pipeline. The opening-balance absorbs the
 * import recorded in `ImportBatchAccountEffects` are then reversed. The whole undo runs in
 * one DB transaction, so a mid-run failure rolls back every delete, unlink and reversal.
 *
 * A batch with no `ImportBatches` row carries only its row stamps: its rows are deleted
 * and nothing is reversed.
 *
 * A batchId with no matching rows and no batch row is a no-op success, not a 404: it's
 * already deleted or belongs to another user, not a mistaken id to correct.
 */
const deleteImportBatchImpl = async ({
  userId,
  batchId,
  deleteLinkedTransfers = false,
  maxRows = MAX_SYNC_BATCH_DELETE_TRANSACTIONS,
}: DeleteImportBatchParams): Promise<DeleteImportBatchResponse & { createdAccountIds: string[] }> => {
  const batch = await ImportBatches.findOne({ where: { userId, batchId }, lock: true });
  const effects = batch ? await ImportBatchAccountEffects.findAll({ where: { importBatchId: batch.id } }) : [];

  // Undoing while the importer still writes rows and has yet to absorb leaves the
  // balance shifted by whatever lands after the undo.
  if (batch && !batch.finishedAt && Date.now() - batch.importedAt.getTime() < UNFINISHED_IMPORT_UNDO_BLOCK_MS) {
    throw new LockedError({ message: t({ key: 'importExport.batchDeleteImportStillRunning' }) });
  }

  const rows = (await Transactions.findWithFilters({
    planned: 'exclude',
    access: { creator: userId },
    completeness: 'all',
    balanceAdjustments: 'include',
    // The uuid column matches any letter case, the stamp is matched as text.
    batchId: batch?.batchId ?? batchId,
    attributes: ['id', 'accountId', 'transferId', 'transferNature'],
    isRaw: true,
  })) as unknown as {
    id: string;
    accountId: string;
    transferId: string | null;
    transferNature: TRANSACTION_TRANSFER_NATURE;
  }[];

  if (rows.length === 0 && !batch) {
    return { deletedCount: 0, deletedIds: [], createdAccountIds: [] };
  }

  // An effect that only marks a created account is left out: this transaction writes
  // nothing to that account, so its being bank-linked must not block the undo.
  const absorbedEffects = effects.filter((effect) => !effect.absorbedAmount.isZero());
  const accountIds = [
    ...new Set([...rows.map((row) => row.accountId), ...absorbedEffects.map((effect) => effect.accountId)]),
  ].toSorted((a, b) => a.localeCompare(b));

  // Take FOR UPDATE on every affected account, in finalize's order, before any row is
  // deleted. The delete hooks take FOR NO KEY UPDATE, and upgrading that to the reversal's
  // FOR UPDATE afterwards deadlocks against a concurrent insert on the same account.
  const bankLinkedAccountIds: string[] = [];
  for (const accountId of accountIds) {
    const account = await lockAccountRow({ accountId });
    if (account && account.type !== ACCOUNT_TYPES.system) bankLinkedAccountIds.push(accountId);
  }

  // `accountType` on a transaction is a creation-time snapshot, so the type comes from
  // the locked account row: a bank link cannot land between this check and the reversal
  // and desync a provider-synced balance.
  // TODO: support undoing a batch whose account was later bank-linked by reconciling
  // against the provider sync instead of refusing outright.
  if (bankLinkedAccountIds.length > 0) {
    captureException({
      error: new Error('Attempted to undo an import batch touching a now bank-linked account'),
      context: { userId, batchId, bankLinkedAccountIds },
    });
    throw new ValidationError({
      message: t({ key: 'importExport.batchDeleteBankLinkedAccount' }),
    });
  }

  // `deleteTransaction` cascade-deletes BOTH legs of a transfer unconditionally — a batch
  // row linked to a pre-existing manual transaction would silently destroy it too, uncounted.
  // Transfers created entirely within this batch (both legs present) are exempt: their
  // normal cascade-delete-together destroys nothing external.
  const transactionIds = rows.map((row) => row.id);
  const batchRowIds = new Set(transactionIds);
  const linkedLegs = rows.filter((row) => isTwoLegTransfer(row.transferNature) && row.transferId);

  let externalTwinIds: string[] = [];
  let legsWithExternalTwin: typeof linkedLegs = [];
  if (linkedLegs.length > 0) {
    // Unauthenticated on purpose, mirroring `deleteTransaction`'s own cascade lookup: a
    // cross-user (shared-account) transfer's twin can belong to a different userId.
    const transferIds = [...new Set(linkedLegs.map((row) => row.transferId!))];
    const twins = (await findTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { transferId: { [Op.in]: transferIds } },
      attributes: ['id', 'transferId'],
      raw: true,
    })) as unknown as { id: string; transferId: string }[];

    const externalTwins = twins.filter((twin) => !batchRowIds.has(twin.id));
    const transferIdsWithExternalTwin = new Set(externalTwins.map((twin) => twin.transferId));
    externalTwinIds = externalTwins.map((twin) => twin.id);
    legsWithExternalTwin = linkedLegs.filter((row) => transferIdsWithExternalTwin.has(row.transferId!));
  }

  const unlinkExternalTwins = externalTwinIds.length > 0 && !deleteLinkedTransfers;

  // A loan leg has no unlink path (see `unlinkTransferTransactions`) — the twin can
  // only go away by being deleted, which the caller hasn't opted into.
  if (
    unlinkExternalTwins &&
    legsWithExternalTwin.some((row) => row.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan)
  ) {
    throw new ValidationError({
      message: t({ key: 'importExport.batchDeleteLinkedLoanTransfer' }),
    });
  }

  // After every refusal check, so an undo that can never succeed is rejected inline
  // instead of being queued and failing in the worker.
  if (rows.length > maxRows) {
    throw new ImportBatchTooLargeError({ rowCount: rows.length });
  }

  if (unlinkExternalTwins) {
    // Unlink BOTH legs (mirrors `unlinkTransferTransactions`) so the surviving external
    // twin lands as a clean standalone row, not a two-leg transfer with no partner.
    // `access: 'unscoped-internal'` matches `deleteTransaction`'s own cascade branch — the
    // twin may belong to a different user on a shared account. No balance impact:
    // `updateTransactions` skips per-instance hooks and the money movement is unchanged.
    await updateTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      values: { transferId: null, transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet },
      where: {
        transferId: { [Op.in]: [...new Set(legsWithExternalTwin.map((row) => row.transferId!))] },
      },
    });
  }

  // Never chunk this list: `bulkDelete` skips a cascade-deleted transfer twin only
  // within one call. A twin in a later chunk gets re-queried after deletion and 404s.
  if (transactionIds.length > 0) {
    await bulkDelete({ userId, transactionIds });
  }

  for (const effect of absorbedEffects) {
    await absorbBalanceAdjustment({
      userId,
      accountId: effect.accountId,
      amountDelta: effect.absorbedAmount.negate(),
    });
  }

  if (batch) {
    await batch.destroy();
  }

  // `bulkDelete`'s result omits cascade-deleted twins. Once it returns, every batch row
  // plus the opted-in twins is gone, so report the full list.
  const deletedIds = deleteLinkedTransfers ? [...transactionIds, ...externalTwinIds] : transactionIds;
  return {
    deletedCount: deletedIds.length,
    deletedIds,
    createdAccountIds: effects.filter((effect) => effect.createdByImport).map((effect) => effect.accountId),
  };
};

const deleteImportBatchInTx = withTransaction(deleteImportBatchImpl);

/**
 * Deletes an account the undone import created once no transaction of any kind is
 * left on it. An account that still holds rows, or is now bank-linked, is kept as is.
 */
const deleteCreatedAccountIfEmpty = withTransaction(
  async ({ userId, accountId }: { userId: number; accountId: string }): Promise<void> => {
    // FOR UPDATE blocks a transaction insert landing between the count and the delete.
    const account = await lockAccountRow({ accountId, userId });
    if (!account || account.type !== ACCOUNT_TYPES.system) return;

    // `paranoid: false`: the account delete cascades to soft-deleted rows too.
    const remaining = await countTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { accountId },
      paranoid: false,
    });
    if (remaining > 0) return;

    await deleteAccountById({ id: accountId, userId });
  },
);

/**
 * Created accounts are removed AFTER the undo transaction commits, each in its own
 * transaction. `deleteAccountById` notifies share recipients as soon as it returns, and
 * a failed SQL statement inside the undo transaction would abort the whole undo.
 */
export const deleteImportBatch = async (params: DeleteImportBatchParams): Promise<DeleteImportBatchResponse> => {
  const { createdAccountIds, ...result } = await deleteImportBatchInTx(params);

  for (const accountId of createdAccountIds) {
    try {
      await deleteCreatedAccountIfEmpty({ userId: params.userId, accountId });
    } catch (error) {
      logger.error(
        { message: '[import batch undo] Failed to delete an account the batch created', error: error as Error },
        {
          code: 'IMPORT_BATCH_UNDO_ACCOUNT_DELETE_FAILED',
          userId: params.userId,
          batchId: params.batchId,
          accountId,
        },
      );
    }
  }

  return result;
};
