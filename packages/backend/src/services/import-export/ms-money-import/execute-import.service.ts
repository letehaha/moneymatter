import {
  ACCOUNT_TYPES,
  type AccountBalanceChange,
  type CategoryMappingConfig,
  ImportSource,
  MS_MONEY_VOID_TAG,
  type MsMoneyAccountMapping,
  type MsMoneyImportSummary,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionImportDetails,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { type OpenImportBatch, withImportBatchRecord } from '@services/import-export/core/import-batch-record';
import { partitionReconcileAccounts } from '@services/import-export/core/partition-reconcile-accounts';
import { startBalanceReconciliation } from '@services/import-export/core/reconcile-account-balances';
import { createAccountsIfNeeded } from '@services/import-export/core/resolve/create-accounts-if-needed';
import { createPayeesIfNeeded } from '@services/import-export/core/resolve/create-payees-if-needed';
import { createNamedTagsIfNeeded } from '@services/import-export/core/resolve/create-tags-if-needed';
import { excludeSkippedAccounts } from '@services/import-export/core/resolve/exclude-skipped-accounts';
import { signedRowContribution } from '@services/import-export/core/signed-row-contribution';
import { createTransaction } from '@services/transactions';
import { selectAccountsWithPlannedRows } from '@services/transactions/planned-matching';
import { v4 as uuidv4 } from 'uuid';

import {
  buildSuppressedFailuresEntry,
  buildSystemicFailureMessage,
  createImportFailureTally,
  recordImportFailure,
  recordImportSuccess,
} from './import-error-collector';
import { resolveMsMoneyCategories } from './resolve-ms-money-categories';
import { deleteMsMoneyUpload, readMsMoneyUpload } from './upload-cache';

interface ExecuteMsMoneyImportParams {
  userId: number;
  /** Id of the cached parse result. The `.mny` bytes never reach this step. */
  uploadId: string;
  accountMapping: MsMoneyAccountMapping;
  /** Per-category decision keyed by the parser's `fullName` ("Auto:Gas").
   *  Parsed categories absent from this map import without a category rather
   *  than being silently created. */
  categoryMapping: CategoryMappingConfig;
  /** Row indices the user confirmed as duplicates against linked accounts. Those
   *  transactions are counted as `duplicatesSkipped` and never written. */
  skipDuplicateIndices: number[];
  /** When true, rows Money marks void are written as zero-amount transactions
   *  tagged "Void". When false/absent they are left out of the import. */
  includeVoidedTransactions?: boolean;
  /** When true, rows dated on/after a linked account's pre-import boundary (day
   *  of its latest existing transaction) move that account's current balance;
   *  older rows are absorbed into `initialBalance`. When false/absent, every
   *  linked account keeps its pre-import balance. Applies only to link-existing
   *  accounts — created accounts derive their balance from the entered
   *  `currentBalance` target / imported rows. */
  recalculateBalance?: boolean;
  /** Called with cumulative `processedCount` after each attempted row so the
   *  BullMQ worker can fan progress out over SSE. Optional — safe to omit in
   *  tests or one-shot callers. */
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
  openImportBatch: OpenImportBatch;
}

/**
 * One-shot writer for a parsed Microsoft Money file. Runs OUTSIDE a wrapping
 * transaction so a single bad row does not nuke the whole import — partial
 * success is the contract documented for the user. Each helper (account /
 * category / payee creation, individual transaction insert, balance targeting)
 * still runs inside its own `withTransaction` further down the call stack.
 *
 * Balance model: `currentBalance = initialBalance + Σ(transactions)`. New
 * accounts are created with a zero initial balance and every imported row is
 * applied; an entered `currentBalance` target is then forced (moving
 * `initialBalance`/`refInitialBalance` without spawning an adjustment
 * transaction). Linked accounts already carry their real balance: their
 * pre-import balance and boundary day are captured before any row lands, and
 * after all rows are written the balance-reconciliation session back-adjusts
 * each one — preserving the balance (recalc OFF) or moving it by the rows dated
 * on/after the boundary (recalc ON, backfill absorbed into `initialBalance`).
 * Skipped duplicates are never written, so they fall out of both paths for free.
 */
async function executeMsMoneyImportImpl({
  userId,
  uploadId,
  accountMapping,
  categoryMapping,
  skipDuplicateIndices,
  includeVoidedTransactions = false,
  recalculateBalance = false,
  onProgress,
  openImportBatch,
}: ExecuteMsMoneyImportParams): Promise<MsMoneyImportSummary> {
  const parsed = await readMsMoneyUpload({ userId, uploadId });

  // Validate every account in the parser output has a mapping — including the
  // ones the user wants skipped, which have to say so explicitly.
  const missingMappings = parsed.accounts.filter((account) => !accountMapping[account.originalName]);
  if (missingMappings.length > 0) {
    throw new ValidationError({
      message: `Missing account mapping for: ${missingMappings.map((account) => account.originalName).join(', ')}`,
    });
  }

  // Skipped accounts leave the import entirely: no account resolution, no rows,
  // and no transfer that touches one of them.
  const skippedAccountNames = new Set(
    parsed.accounts
      .filter((account) => accountMapping[account.originalName]!.action === 'skip')
      .map((account) => account.originalName),
  );
  const importableAccounts = parsed.accounts.filter((account) => !skippedAccountNames.has(account.originalName));

  const importableMapping = excludeSkippedAccounts({ accountMapping });

  const importDetails: TransactionImportDetails = {
    batchId: uuidv4(),
    importedAt: new Date().toISOString(),
    source: ImportSource.msMoney,
  };

  // The wire type marks `accountBalanceChanges`, `voidedImported` and `merged`
  // optional only for retained job results produced before those fields existed;
  // this executor always emits all three, so the local type re-requires them to
  // keep the pushes and increments below well-typed.
  const summary: MsMoneyImportSummary & {
    accountBalanceChanges: AccountBalanceChange[];
    voidedImported: number;
    merged: number;
  } = {
    accountsCreated: 0,
    accountsLinked: 0,
    accountsSkipped: skippedAccountNames.size,
    categoriesCreated: 0,
    payeesCreated: 0,
    transactionsImported: 0,
    transfersImported: 0,
    outOfWalletImported: 0,
    voidedImported: 0,
    merged: 0,
    duplicatesSkipped: 0,
    errors: [],
    accountBalanceChanges: [],
  };

  const skipSet = new Set(skipDuplicateIndices);

  // Rows and transfers that survive both filters — a skipped account removes
  // everything that touches it, and a confirmed duplicate removes the row.
  // Voided rows are dropped here unless the user opted in, so they fall out of
  // the duplicate tally and the payee resolution too.
  const importableTransactions = parsed.transactions.filter(
    (tx) => !skippedAccountNames.has(tx.accountName) && (includeVoidedTransactions || !tx.isVoid),
  );
  const transfersToWrite = parsed.transfers.filter(
    (xfer) => !skippedAccountNames.has(xfer.sourceAccountName) && !skippedAccountNames.has(xfer.destinationAccountName),
  );

  // Progress total counts only rows that will actually be written. Skipped rows
  // never tick, so the worker's `processedCount === totalCount` check holds.
  const transactionsToWrite = importableTransactions.filter((tx) => !skipSet.has(tx.rowIndex));
  const totalCount = transactionsToWrite.length + transfersToWrite.length;

  // Report the real total once up front. The per-row `tick` is the only other
  // caller of `onProgress`, so an import that writes no rows would otherwise
  // never surface its total and the worker would report `totalCount: 0`.
  if (onProgress) await onProgress(0, totalCount);

  // Convert new-account starting balances at the earliest date in the file, not
  // today — a Money file spans years and today's FX rate would skew
  // refInitialBalance. Fall back to today when nothing parsed.
  const initialBalanceFxDate = parsed.dateRange ? new Date(parsed.dateRange.from) : new Date();

  // Phase 1: bootstrap currencies for every account that will be created. Linked
  // accounts already have their currency connected (it's an existing account).
  const currencyCodes = new Set<string>();
  for (const account of importableAccounts) {
    const mapping = accountMapping[account.originalName]!;
    if (mapping.action === 'create-new') currencyCodes.add(mapping.currencyCode);
  }
  if (currencyCodes.size > 0) {
    await addUserCurrencies(Array.from(currencyCodes).map((currencyCode) => ({ userId, currencyCode })));
  }

  // Phase 2: accounts. One concern the shared resolver does not cover is handled
  // here first, before any rows are written: the mapping's currency must agree
  // with the currency the parser read from the file, whether the account is
  // linked (a UAH Money account cannot post to a USD app account) or created (the
  // client sends the currency back, so it is not authoritative). This loop also
  // checks link-existing ownership and tallies `accountsLinked`; the actual id
  // resolution and new-account creation is then delegated to
  // `createAccountsIfNeeded`.
  for (const account of importableAccounts) {
    const mapping = accountMapping[account.originalName]!;

    if (mapping.action === 'create-new') {
      if (mapping.currencyCode !== account.currency) {
        throw new ValidationError({
          message: `Account "${account.originalName}" (${account.currency}) cannot be created as "${mapping.currencyCode}" — a new account must use the currency from the file.`,
        });
      }
      continue;
    }
    if (mapping.action !== 'link-existing') continue;

    const existing = await Accounts.getAccountById({ userId, id: mapping.accountId });
    if (!existing) {
      throw new ValidationError({
        message: `Account "${account.originalName}" is linked to an account that does not exist or is not yours.`,
      });
    }
    if (existing.currencyCode !== account.currency) {
      throw new ValidationError({
        message: `Account "${account.originalName}" (${account.currency}) cannot be linked to "${existing.name}" (${existing.currencyCode}) — currencies must match.`,
      });
    }
    summary.accountsLinked += 1;
  }

  // Resolve every importable account to an app account id, creating new ones with
  // a zero starting balance (the imported rows build the balance up; the
  // user-entered target is restored in Phase 7). New-account currency comes from
  // the user-confirmed mapping; the fx reference date is the earliest parsed date.
  // `accountsCreated` counts only genuine inserts.
  const { accountNameToId: accountIdByName, accountsCreated } = await createAccountsIfNeeded({
    userId,
    accountNames: importableAccounts.map((account) => account.originalName),
    accountMapping: importableMapping,
    resolveCurrencyCode: (accountName) => {
      const mapping = accountMapping[accountName];
      return mapping?.action === 'create-new' ? mapping.currencyCode : undefined;
    },
    resolveFxDate: () => initialBalanceFxDate,
  });
  summary.accountsCreated = accountsCreated;

  // Snapshot every linked account BEFORE any row is written: balance-before +
  // boundary day (day of its latest existing transaction). Phase 7 reconciles
  // each linked account against this snapshot. Created accounts are excluded —
  // they have no history to protect and follow the Phase-7 target-balance path.
  const { capturedAccountIds, createdAccounts } = partitionReconcileAccounts({
    accountNameToId: accountIdByName,
    accountMapping: importableMapping,
  });
  const importBatchId = await openImportBatch({
    userId,
    importDetails,
    createdAccountIds: createdAccounts.map((account) => account.accountId),
  });
  const reconciler = await startBalanceReconciliation({ userId, accountIds: capturedAccountIds });

  const plannedMatchAccountIds = await selectAccountsWithPlannedRows({ accountIds: capturedAccountIds });

  // Phase 3: categories. Money nests them two deep, so a create-new leaf also
  // rebuilds its parent group; link-existing only verifies ownership. Categories
  // the user left out of the mapping resolve to nothing, so those rows import
  // without a category rather than being silently created.
  const { categoryIdByFullName, categoriesCreated } = await resolveMsMoneyCategories({
    userId,
    categories: parsed.categories,
    categoryMapping,
  });
  summary.categoriesCreated = categoriesCreated;

  // Phase 4: resolve every distinct non-empty payee (ordinary rows,
  // out-of-wallet legs and transfers) to a Payee id via the shared resolver —
  // canonicalized through the user's payee namespace, reused by canonical name or
  // alias, else inserted. `payeesCreated` counts genuine inserts only. Scans the
  // post-skip row set, so a payee confined to a skipped-duplicate row creates no
  // orphan Payee. Each id is passed explicitly to `createTransaction` below (raw
  // name kept as `rawMerchantName`), so no merchant re-extraction runs there.
  const payeeNames = Array.from(
    new Set(
      [...transactionsToWrite.map((tx) => tx.payeeName), ...transfersToWrite.map((xfer) => xfer.payeeName)].filter(
        (name): name is string => name != null && name.trim() !== '',
      ),
    ),
  );
  const { payeeNameToId, payeesCreated } = await createPayeesIfNeeded({ userId, payeeNames });
  summary.payeesCreated = payeesCreated;

  // Phase 4b: the "Void" tag, only when a voided row will actually be written.
  // A voided row lands at amount 0, so without the tag it is indistinguishable
  // from an ordinary zero row in the transactions list.
  const hasVoidedRows = transactionsToWrite.some((tx) => tx.isVoid);
  const voidTagId = hasVoidedRows
    ? (await createNamedTagsIfNeeded({ userId, tags: [{ ...MS_MONEY_VOID_TAG }] })).tagIdByName.get(
        MS_MONEY_VOID_TAG.name,
      )
    : undefined;

  let processedCount = 0;
  const tick = async () => {
    processedCount += 1;
    if (!onProgress) return;
    // Progress reporting is a best-effort side-effect (it fans out over SSE). A
    // failure here must never reject the import or be attributed to a row, so it
    // is contained and logged rather than propagated. The count is already
    // advanced above, so a dropped tick does not desync the final total.
    try {
      await onProgress(processedCount, totalCount);
    } catch (err) {
      logger.error({ message: '[MS Money import] Progress callback failed', error: err as Error });
    }
  };

  // Failure bookkeeping shared by the row and transfer loops: caps how many
  // errors the summary retains and how many reach the log, and detects a run of
  // failures that means the import itself broke rather than the rows.
  let failureTally = createImportFailureTally();

  // Phase 5: transactions (ordinary rows + unpaired transfer legs). Rows the
  // user confirmed as duplicates are counted and skipped without a tick.
  for (const tx of importableTransactions) {
    if (skipSet.has(tx.rowIndex)) {
      summary.duplicatesSkipped += 1;
      continue;
    }
    try {
      const accountId = accountIdByName.get(tx.accountName);
      if (!accountId) throw new ValidationError({ message: `Unknown account "${tx.accountName}"` });

      const transactionType = tx.type;
      const amount = Money.fromDecimal(Math.abs(tx.amount));

      // Out-of-wallet legs carry no real category and model money leaving/entering
      // the tracked set of accounts, so they import as `transfer_out_wallet` with
      // no destination account and no category. Ordinary rows resolve their
      // category through the mapping; an unmapped name yields undefined.
      const categoryId = !tx.outOfWallet && tx.categoryName ? categoryIdByFullName.get(tx.categoryName) : undefined;
      const transferNature = tx.outOfWallet
        ? TRANSACTION_TRANSFER_NATURE.transfer_out_wallet
        : TRANSACTION_TRANSFER_NATURE.not_transfer;

      // Link the Phase 4 Payee explicitly (caller id wins over createTransaction's
      // extraction); `rawMerchantName` keeps the raw name. An empty payee resolves
      // to undefined → imports without a Payee.
      const payeeId = tx.payeeName ? payeeNameToId.get(tx.payeeName) : undefined;

      // Money's check / reference number is worth keeping, but only where there
      // is no memo to overwrite.
      const baseNote = tx.note.trim() === '' && tx.referenceNumber ? tx.referenceNumber : tx.note;
      // A voided row is written at zero, so the amount Money kept on it would
      // otherwise be lost entirely.
      const note =
        tx.isVoid && tx.voidedAmount
          ? `${baseNote} (voided: ${Math.abs(tx.voidedAmount).toFixed(2)})`.trim()
          : baseNote;

      const createResult = await createTransaction({
        userId,
        accountId,
        amount,
        commissionRate: Money.zero(),
        note,
        time: new Date(tx.date),
        transactionType,
        // Money has no payment-type column, so every row lands on the neutral
        // default rather than a guess from the memo.
        paymentType: PAYMENT_TYPES.bankTransfer,
        accountType: ACCOUNT_TYPES.system,
        transferNature,
        categoryId,
        tagIds: tx.isVoid && voidTagId ? [voidTagId] : undefined,
        payeeId,
        rawMerchantName: tx.payeeName || null,
        externalData: { importDetails },
        // A category from the mapped Money category is authoritative and beats a
        // linked Payee's enforce/hint default. Inert when the row has no mapped
        // category, so Payee categorization still runs then.
        categoryIdIsExplicit: categoryId != null,
        matchPlanned: plannedMatchAccountIds.has(accountId),
      });

      // Fold this committed row into the per-account balance tally IMMEDIATELY
      // after the commit: the balance hook has already moved `currentBalance`, so
      // a row missing from the tally would make the reconcile adjustment too
      // large with no desync error. Signed the way the hook applied it (income
      // adds, expense subtracts).
      reconciler.recordRow({
        accountId,
        rowIso: tx.date,
        ...signedRowContribution({
          isIncome: transactionType === TRANSACTION_TYPES.income,
          amount,
        }),
      });

      // A merged row is an existing planned transaction, not a newly imported one.
      if (createResult.mergedIntoPlanned) {
        summary.merged += 1;
      } else if (tx.isVoid) {
        summary.voidedImported += 1;
      } else if (tx.outOfWallet) {
        summary.outOfWalletImported += 1;
      } else {
        summary.transactionsImported += 1;
      }

      failureTally = recordImportSuccess({ tally: failureTally });
    } catch (err) {
      const decision = recordImportFailure({ tally: failureTally, rowIndices: [tx.rowIndex] });
      failureTally = decision.tally;

      if (decision.shouldLog) {
        logger.error({
          message: `[MS Money import] Failed to import transaction (row ${tx.rowIndex}, account "${tx.accountName}")`,
          error: err as Error,
        });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      for (const rowIndex of decision.retainedRowIndices) {
        summary.errors.push({ rowIndex, error: message });
      }

      // Rows failing back to back point at the import (dead DB connection),
      // not the data. Fail the job so the user retries rather than handing them
      // a "completed" import whose rows mostly never landed.
      if (decision.shouldAbort) {
        throw new UnexpectedError({ message: buildSystemicFailureMessage({ lastError: err }) });
      }
    }
    // Tick once per attempted row, regardless of success or failure, and OUTSIDE
    // the correctness try/catch: a progress/SSE error must not be recorded as a
    // fake per-row import error against a row that did commit, nor abort the run.
    await tick();
  }

  // Phase 6: transfers. Money links both legs explicitly and records the exact
  // amount on each side, so a cross-currency transfer carries a distinct source
  // amount and destination amount (e.g. 100 USD leaving, 92 EUR arriving). Both
  // values are passed straight through: `createTransaction` with
  // `common_transfer` writes the source (expense) and destination (income) legs
  // and links them via `transferId`.
  for (const xfer of transfersToWrite) {
    try {
      const sourceAccountId = accountIdByName.get(xfer.sourceAccountName);
      const destinationAccountId = accountIdByName.get(xfer.destinationAccountName);
      if (!sourceAccountId || !destinationAccountId) {
        throw new ValidationError({
          message: `Transfer references unknown account ("${xfer.sourceAccountName}" or "${xfer.destinationAccountName}").`,
        });
      }

      // Money records one payee for the pair, so it lands on the source leg.
      const payeeId = xfer.payeeName ? payeeNameToId.get(xfer.payeeName) : undefined;

      const [, destinationLeg] = await createTransaction({
        userId,
        accountId: sourceAccountId,
        amount: Money.fromDecimal(xfer.sourceAmount),
        commissionRate: Money.zero(),
        note: xfer.note,
        time: new Date(xfer.date),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: PAYMENT_TYPES.bankTransfer,
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId,
        destinationAmount: Money.fromDecimal(xfer.destinationAmount),
        payeeId,
        rawMerchantName: xfer.payeeName || null,
        externalData: { importDetails },
      });

      // `createTransaction` types the destination leg optional for non-transfer
      // calls; a `common_transfer` always writes and returns both legs. A missing
      // destination leg means the destination account's balance moved without a
      // matching tally entry — surface it instead of silently desyncing.
      if (!destinationLeg) {
        throw new ValidationError({
          message: `Transfer destination leg missing for "${xfer.sourceAccountName}" → "${xfer.destinationAccountName}"; account balances may be incorrect.`,
        });
      }

      // Each transfer leg lands on its own account, so each is recorded against
      // that account's own boundary: source loses `sourceAmount` (expense),
      // destination gains `destinationAmount` (income).
      reconciler.recordRow({
        accountId: sourceAccountId,
        rowIso: xfer.date,
        ...signedRowContribution({
          isIncome: false,
          amount: Money.fromDecimal(xfer.sourceAmount),
        }),
      });
      reconciler.recordRow({
        accountId: destinationAccountId,
        rowIso: xfer.date,
        ...signedRowContribution({
          isIncome: true,
          amount: Money.fromDecimal(xfer.destinationAmount),
        }),
      });

      summary.transfersImported += 1;

      failureTally = recordImportSuccess({ tally: failureTally });
    } catch (err) {
      // One error per leg so a user scanning by row index can find both halves of
      // the failed transfer, not just the expense leg.
      const decision = recordImportFailure({ tally: failureTally, rowIndices: xfer.rowIndices });
      failureTally = decision.tally;

      if (decision.shouldLog) {
        logger.error({
          message: `[MS Money import] Failed to import transfer ("${xfer.sourceAccountName}" → "${xfer.destinationAccountName}", rows ${xfer.rowIndices.join(', ')})`,
          error: err as Error,
        });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      for (const rowIndex of decision.retainedRowIndices) {
        summary.errors.push({ rowIndex, error: message });
      }

      if (decision.shouldAbort) {
        throw new UnexpectedError({ message: buildSystemicFailureMessage({ lastError: err }) });
      }
    }
    // Tick once per attempted transfer, regardless of success or failure, and
    // OUTSIDE the correctness try/catch: a progress/SSE error must not be
    // recorded as a fake import error nor abort the run.
    await tick();
  }

  // Close out the capped failure reporting before the account-level balance
  // errors are appended: one entry standing in for every error the summary did
  // not retain, and one log line for the failures that were not logged.
  const suppressedFailuresEntry = buildSuppressedFailuresEntry({ tally: failureTally });
  if (suppressedFailuresEntry) summary.errors.push(suppressedFailuresEntry);
  if (failureTally.unloggedFailures > 0) {
    logger.error({
      message: `[MS Money import] ${failureTally.unloggedFailures} further row failures were not logged individually`,
    });
  }

  // Phase 7: balance targeting. Must run AFTER all rows are written so the
  // back-adjustment is computed against the current balance the imported
  // transactions produced. `finalize` owns the whole pass: created accounts
  // (partitioned alongside the captured set in Phase 2) get their entered
  // `currentBalance` (when non-null) forced as the final value (a null target
  // leaves the balance at Σ(imported rows)) plus a summary entry read back
  // afterwards; linked accounts are back-adjusted against their pre-import
  // snapshot — preserved (recalc OFF) or moved by the rows dated on/after the
  // boundary (recalc ON). A failed balance write surfaces as
  // `account-balance-desync`: the rows are committed, so the user must see and
  // fix the balance manually.
  const { accountBalanceChanges, errors: balanceErrors } = await reconciler.finalize({
    importBatchId,
    recalculateBalance,
    createdAccounts,
    logLabel: 'MS Money import',
  });
  summary.accountBalanceChanges.push(...accountBalanceChanges);
  summary.errors.push(...balanceErrors);

  // The cached parse result has served its purpose. Dropping it early frees the
  // disk entry ahead of the sweeper; a failure only delays that, so it must not
  // fail an import whose rows are already committed.
  try {
    await deleteMsMoneyUpload({ userId, uploadId });
  } catch (err) {
    logger.error({ message: '[MS Money import] Failed to delete cached upload', error: err as Error });
  }

  return summary;
}

export const executeMsMoneyImport = withImportBatchRecord(executeMsMoneyImportImpl);
