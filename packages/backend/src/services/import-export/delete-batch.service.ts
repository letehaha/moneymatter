import {
  ACCOUNT_TYPES,
  type DeleteImportBatchResponse,
  TRANSACTION_TRANSFER_NATURE,
  isTwoLegTransfer,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { LockedError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import { countTransactions, findTransactions, updateTransactions } from '@models/transactions-query';
import { trashedWhere } from '@models/transactions-query/deletion-where';
import * as Transactions from '@models/transactions.model';
import { deleteAccountById } from '@services/accounts.service';
import { absorbBalanceAdjustment } from '@services/accounts/absorb-balance-adjustment';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { type SeamAccount, getSeamStart, isRowDeletableOnAccount } from '@services/accounts/seam';
import { revalueBalanceHistory } from '@services/balances/revalue-balance-history.service';
import { withTransaction } from '@services/common/with-transaction';
import { isImportBatchUnfinished } from '@services/import-export/core/unfinished-import';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { destroyTrashedRows } from '@services/transactions/trash/delete-trashed';
import { Op, literal, where as sequelizeWhere } from 'sequelize';

interface DeleteImportBatchParams {
  userId: number;
  batchId: string;
  /** Explicit opt-in to hard-delete a transfer's other leg when it lies outside the
   *  batch (a pre-existing manual transaction the import got linked to). Default
   *  `false` unlinks the batch's own leg to `transfer_out_wallet` instead, leaving the
   *  external transaction untouched. */
  deleteLinkedTransfers?: boolean;
  /** Rows above this count throw `ImportBatchTooLargeError` instead of deleting.
   *  The background worker passes `Infinity`, which deletes row by row. */
  maxRows?: number;
}

// The inline undo runs in one transaction, where each row's balance cascade slows the
// next one; above this the background job deletes row by row (see delete-batch-queue.ts).
const MAX_SYNC_BATCH_DELETE_TRANSACTIONS = 100;

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
 * import recorded in `ImportBatchAccountEffects` are then reversed.
 *
 * A batch with no `ImportBatches` row carries only its row stamps: its rows are deleted
 * and nothing is reversed.
 *
 * A batchId with no matching rows and no batch row is a no-op success, not a 404: it's
 * already deleted or belongs to another user, not a mistaken id to correct.
 */
type BatchLeg = { id: string; transferId: string | null; transferNature: TRANSACTION_TRANSFER_NATURE };

/** Loads the batch, takes the account locks, runs every refusal check and unlinks
 *  external transfer twins. `null` when there is nothing to undo. */
const planUndo = async ({
  userId,
  batchId,
  deleteLinkedTransfers = false,
  maxRows = MAX_SYNC_BATCH_DELETE_TRANSACTIONS,
}: DeleteImportBatchParams) => {
  const batch = await ImportBatches.findOne({ where: { userId, batchId }, lock: true });
  const effects = batch ? await ImportBatchAccountEffects.findAll({ where: { importBatchId: batch.id } }) : [];

  // Undoing while the importer still writes rows and has yet to absorb leaves the
  // balance shifted by whatever lands after the undo.
  if (batch && isImportBatchUnfinished({ batch })) {
    throw new LockedError({ message: t({ key: 'importExport.batchDeleteImportStillRunning' }) });
  }

  const rows = (await Transactions.findWithFilters({
    planned: 'exclude',
    access: { creator: userId },
    completeness: 'all',
    balanceAdjustments: 'include',
    // The uuid column matches any letter case, the stamp is matched as text.
    batchId: batch?.batchId ?? batchId,
    attributes: ['id', 'accountId', 'accountType', 'time', 'transferId', 'transferNature'],
    isRaw: true,
  })) as unknown as {
    id: string;
    accountId: string;
    accountType: ACCOUNT_TYPES;
    time: Date;
    transferId: string | null;
    transferNature: TRANSACTION_TRANSFER_NATURE;
  }[];

  // Trashed rows of the batch go for good too; their balance was taken back when they were trashed.
  const trashedRows = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    completeness: 'all',
    balanceAdjustments: 'include',
    paranoid: false,
    where: {
      ...trashedWhere,
      [Op.and]: [
        sequelizeWhere(
          literal(`"Transactions"."externalData"->'importDetails'->>'batchId'`),
          batch?.batchId ?? batchId,
        ),
      ],
    },
    attributes: ['id', 'transferId', 'transferNature'],
  });
  const trashedIds = trashedRows.map((row) => row.id);

  if (rows.length === 0 && trashedIds.length === 0 && !batch) return null;

  // An effect that only marks a created account is left out: this transaction writes
  // nothing to that account, so its being bank-linked must not block the undo.
  const absorbedEffects = effects.filter((effect) => !effect.absorbedAmount.isZero());
  const accountIds = [
    ...new Set([...rows.map((row) => row.accountId), ...absorbedEffects.map((effect) => effect.accountId)]),
  ].toSorted((a, b) => a.localeCompare(b));

  // Take FOR UPDATE on every affected account, in finalize's order, before any row is
  // deleted. The delete hooks take FOR NO KEY UPDATE, and upgrading that to the reversal's
  // FOR UPDATE afterwards deadlocks against a concurrent insert on the same account.
  // A seam account takes the undo through the seam-aware delete.
  const bankLinkedAccountIds: string[] = [];
  const seamAccounts = new Map<string, SeamAccount>();
  for (const accountId of accountIds) {
    const account = await lockAccountRow({ accountId });
    if (!account || account.type === ACCOUNT_TYPES.system) continue;
    if (getSeamStart({ account })) seamAccounts.set(accountId, account);
    else bankLinkedAccountIds.push(accountId);
  }

  // Rows `bulkDelete` would refuse: on a seam account, dated from its seam on.
  const rowsOwnedBySeamCount = rows.filter((row) => {
    const account = seamAccounts.get(row.accountId);
    return account && !isRowDeletableOnAccount({ account, transaction: row });
  }).length;

  // `accountType` on a transaction is a creation-time snapshot, so the type comes from
  // the locked account row: a bank link cannot land between this check and the reversal
  // and desync a provider-synced balance.
  if (bankLinkedAccountIds.length > 0 || rowsOwnedBySeamCount > 0) {
    logger.info('[import batch undo] Refused: batch touches a now bank-linked account', {
      userId,
      batchId,
      bankLinkedAccountIds,
      rowsOwnedBySeamCount,
    });
    throw new ValidationError({
      message: t({ key: 'importExport.batchDeleteBankLinkedAccount' }),
    });
  }

  // `deleteTransaction` cascade-deletes BOTH legs of a transfer unconditionally — a batch
  // row linked to a pre-existing manual transaction would silently destroy it too, uncounted.
  // Transfers created entirely within this batch (both legs present) are exempt: their
  // normal cascade-delete-together destroys nothing external.
  // Pairs are trashed together, so a trashed leg's twin is a trashed row, and a live leg's twin a live one.
  const findExternalTwins = async ({ legs, trashed }: { legs: BatchLeg[]; trashed: boolean }) => {
    const linkedLegs = legs.filter((row) => isTwoLegTransfer(row.transferNature) && row.transferId);
    if (linkedLegs.length === 0) return { twinIds: [] as string[], legsWithTwin: [] as BatchLeg[] };

    const ownIds = new Set(legs.map((row) => row.id));
    // Unauthenticated on purpose, mirroring `deleteTransaction`'s own cascade lookup: a
    // cross-user (shared-account) transfer's twin can belong to a different userId.
    const twins = (await findTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      paranoid: !trashed,
      where: {
        transferId: { [Op.in]: [...new Set(linkedLegs.map((row) => row.transferId!))] },
        ...(trashed ? trashedWhere : {}),
      },
      attributes: ['id', 'transferId'],
      raw: true,
    })) as unknown as { id: string; transferId: string }[];

    const externalTwins = twins.filter((twin) => !ownIds.has(twin.id));
    const transferIdsWithExternalTwin = new Set(externalTwins.map((twin) => twin.transferId));
    return {
      twinIds: externalTwins.map((twin) => twin.id),
      legsWithTwin: linkedLegs.filter((row) => transferIdsWithExternalTwin.has(row.transferId!)),
    };
  };

  const transactionIds = rows.map((row) => row.id);
  const liveTwins = await findExternalTwins({ legs: rows, trashed: false });
  const trashedTwins = await findExternalTwins({ legs: trashedRows, trashed: true });
  const externalTwinIds = [...liveTwins.twinIds, ...trashedTwins.twinIds];
  const legsWithExternalTwin = [...liveTwins.legsWithTwin, ...trashedTwins.legsWithTwin];

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
        [Op.or]: [{ deletedAt: null }, trashedWhere],
      },
      paranoid: false,
    });
  }

  return {
    batch,
    effects,
    rows,
    seamAccounts,
    absorbedEffects,
    trashedIds,
    transactionIds,
    liveTwinIds: liveTwins.twinIds,
    trashedTwinIds: trashedTwins.twinIds,
  };
};

type UndoPlan = NonNullable<Awaited<ReturnType<typeof planUndo>>>;

const finishUndo = async ({
  userId,
  deleteLinkedTransfers = false,
  plan: { batch, effects, seamAccounts, absorbedEffects, trashedIds, transactionIds, liveTwinIds, trashedTwinIds },
}: {
  userId: number;
  deleteLinkedTransfers?: boolean;
  plan: UndoPlan;
}) => {
  const trashedToDestroy = [...trashedIds, ...(deleteLinkedTransfers ? trashedTwinIds : [])];
  await destroyTrashedRows({ transactionIds: trashedToDestroy });

  // Inline so a failed rebuild fails the undo; it re-derives a seam account's opening balance.
  for (const accountId of seamAccounts.keys()) {
    await revalueBalanceHistory({ accountId });
  }

  for (const effect of absorbedEffects.filter(({ accountId }) => !seamAccounts.has(accountId))) {
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
  const deletedIds = [...transactionIds, ...(deleteLinkedTransfers ? liveTwinIds : []), ...trashedToDestroy];
  return {
    deletedCount: deletedIds.length,
    deletedIds,
    createdAccountIds: effects.filter((effect) => effect.createdByImport).map((effect) => effect.accountId),
  };
};

const emptyUndo = () => ({ deletedCount: 0, deletedIds: [] as string[], createdAccountIds: [] as string[] });

/** Undoes the batch in one transaction, so a mid-run failure rolls everything back. */
const deleteImportBatchInTx = withTransaction(async (params: DeleteImportBatchParams) => {
  const plan = await planUndo(params);
  if (!plan) return emptyUndo();

  // One call: `bulkDelete` skips a cascade-deleted transfer twin only within the same call.
  if (plan.transactionIds.length > 0) {
    await bulkDelete({
      userId: params.userId,
      transactionIds: plan.transactionIds,
      maxCount: Infinity,
      permanent: true,
    });
  }
  return finishUndo({ ...params, plan });
});

/**
 * Background path: every row is deleted in its own transaction. Each delete cascades an
 * UPDATE over the account's later `Balances` rows, and inside one transaction the dead row
 * versions pile up so every cascade gets slower. The closing pass is the one-transaction
 * undo over what is left, so its checks and reversals run against fresh, locked state.
 * Not atomic: an interrupted run leaves the batch partly deleted, and a rerun finishes it.
 */
const deleteImportBatchRowByRow = async (params: DeleteImportBatchParams) => {
  const plan = await withTransaction(planUndo)(params);
  if (!plan) return emptyUndo();

  const deletedTransferIds = new Set<string>();
  for (const row of plan.rows) {
    if (row.transferId && deletedTransferIds.has(row.transferId)) continue;
    try {
      await bulkDelete({ userId: params.userId, transactionIds: [row.id], maxCount: Infinity, permanent: true });
    } catch (error) {
      // Already gone (e.g. removed by a co-user of a shared account): nothing left to delete.
      if (!(error instanceof NotFoundError)) throw error;
    }
    if (row.transferId) deletedTransferIds.add(row.transferId);
  }

  const closing = await deleteImportBatchInTx(params);
  const deletedIds = [
    ...plan.transactionIds,
    ...(params.deleteLinkedTransfers ? plan.liveTwinIds : []),
    ...closing.deletedIds,
  ];
  return { ...closing, deletedCount: deletedIds.length, deletedIds };
};

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
  const undo = params.maxRows === Infinity ? deleteImportBatchRowByRow : deleteImportBatchInTx;
  const { createdAccountIds, ...result } = await undo(params);

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
