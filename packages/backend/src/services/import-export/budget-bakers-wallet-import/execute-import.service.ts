import {
  ACCOUNT_TYPES,
  type AccountBalanceChange,
  type BudgetBakersWalletAccountMapping,
  type BudgetBakersWalletImportSummary,
  type CategoryMappingConfig,
  ImportSource,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionImportDetails,
} from '@bt/shared/types';
import { pickRandomColor } from '@common/lib/random-color';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { type OpenImportBatch, withImportBatchRecord } from '@services/import-export/core/import-batch-record';
import { partitionReconcileAccounts } from '@services/import-export/core/partition-reconcile-accounts';
import { startBalanceReconciliation } from '@services/import-export/core/reconcile-account-balances';
import { createAccountsIfNeeded } from '@services/import-export/core/resolve/create-accounts-if-needed';
import { createCategoriesIfNeeded } from '@services/import-export/core/resolve/create-categories-if-needed';
import { createPayeesIfNeeded } from '@services/import-export/core/resolve/create-payees-if-needed';
import { createNamedTagsIfNeeded } from '@services/import-export/core/resolve/create-tags-if-needed';
import { excludeSkippedAccounts } from '@services/import-export/core/resolve/exclude-skipped-accounts';
import { signedRowContribution } from '@services/import-export/core/signed-row-contribution';
import { applyPayeeDefaultTags } from '@services/payees/apply-default-tags';
import { createTransaction } from '@services/transactions';
import { selectAccountsWithPlannedRows } from '@services/transactions/planned-matching';
import { v4 as uuidv4 } from 'uuid';

import { mapBudgetBakersWalletPaymentType } from './localized-values';
import { parseBudgetBakersWalletCsv } from './parse-budget-bakers-wallet.service';

interface ExecuteBudgetBakersWalletImportParams {
  userId: number;
  fileContent: string;
  accountMapping: BudgetBakersWalletAccountMapping;
  /** Per-category decision keyed by the verbatim Wallet `category` value. Drives
   *  link-existing-vs-create resolution (see `createCategoriesIfNeeded`). The
   *  transfer-marker category is never present here, and parsed categories absent
   *  from this map import without a category rather than being silently created. */
  categoryMapping: CategoryMappingConfig;
  /** Row indices the user confirmed as duplicates against linked accounts. Those
   *  transactions are counted as `duplicatesSkipped` and never written. */
  skipDuplicateIndices: number[];
  /** When true, rows dated on/after a linked account's pre-import boundary (day
   *  of its latest existing transaction) move that account's current balance;
   *  older rows are absorbed into `initialBalance`. When false/absent, every
   *  linked account keeps its pre-import balance. Applies only to link-existing
   *  accounts — created accounts derive their balance from the entered
   *  `currentBalance` target / imported rows. */
  recalculateBalance?: boolean;
  /** Called with cumulative `processedCount` after each committed row so the
   *  BullMQ worker can fan progress out over SSE. Optional — safe to omit in
   *  tests or one-shot callers. */
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
  openImportBatch: OpenImportBatch;
}

/**
 * One-shot writer for a parsed Wallet (BudgetBakers) CSV export. Runs OUTSIDE a
 * wrapping transaction so a single bad row does not nuke the whole import —
 * partial success is the contract documented for the user. Each helper (account
 * / category / tag creation, individual transaction insert, balance targeting)
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
async function executeBudgetBakersWalletImportImpl({
  userId,
  fileContent,
  accountMapping,
  categoryMapping,
  skipDuplicateIndices,
  recalculateBalance = false,
  onProgress,
  openImportBatch,
}: ExecuteBudgetBakersWalletImportParams): Promise<BudgetBakersWalletImportSummary> {
  const parsed = parseBudgetBakersWalletCsv({ fileContent });

  // Validate every distinct account name in the parser output has a mapping.
  const missingMappings = parsed.accounts.filter((a) => !accountMapping[a.originalName]);
  if (missingMappings.length > 0) {
    throw new ValidationError({
      message: `Missing account mapping for: ${missingMappings.map((a) => a.originalName).join(', ')}`,
    });
  }

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
    source: ImportSource.budgetBakersWallet,
  };

  // The wire type marks `accountBalanceChanges` and `merged` optional only for
  // retained job results produced before those fields existed; this executor
  // always emits both, so the local type re-requires them to keep the pushes
  // and increments below well-typed.
  const summary: BudgetBakersWalletImportSummary & {
    accountBalanceChanges: AccountBalanceChange[];
    merged: number;
  } = {
    accountsCreated: 0,
    accountsLinked: 0,
    accountsSkipped: skippedAccountNames.size,
    categoriesCreated: 0,
    payeesCreated: 0,
    tagsCreated: 0,
    transactionsImported: 0,
    transfersImported: 0,
    outOfWalletImported: 0,
    merged: 0,
    duplicatesSkipped: 0,
    errors: [],
    accountBalanceChanges: [],
  };

  const skipSet = new Set(skipDuplicateIndices);

  // Drop a transfer when either leg lands on a skipped account: writing the
  // surviving leg alone would reference an account that was never resolved.
  const importableTransactions = parsed.transactions.filter((tx) => !skippedAccountNames.has(tx.accountName));
  const transfersToWrite = parsed.transfers.filter(
    (xfer) => !skippedAccountNames.has(xfer.sourceAccountName) && !skippedAccountNames.has(xfer.destinationAccountName),
  );

  // Progress total counts only rows that will actually be written: transactions
  // not flagged as duplicates, plus every paired transfer. Skipped rows never
  // tick, so the worker's `processedCount === totalCount` completion check holds.
  const transactionsToWrite = importableTransactions.filter((tx) => !skipSet.has(tx.rowIndex));
  const totalCount = transactionsToWrite.length + transfersToWrite.length;

  // Report the real total once up front. The per-row `tick` is the only other
  // caller of `onProgress`, so an import that writes no rows would otherwise
  // never surface its total and the worker would report `totalCount: 0`.
  if (onProgress) await onProgress(0, totalCount);

  // Convert new-account starting balances at the earliest CSV date, not today —
  // Wallet exports span years and today's FX rate would skew refInitialBalance.
  // Fall back to today when the parser found no usable dates at all.
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

  // Phase 2: accounts. One concern the shared resolver does not cover is
  // handled here first, before any rows are written: Wallet's link-existing
  // currency match (a UAH CSV account cannot post to a USD app account). This
  // loop validates every link-existing mapping (ownership + currency) with
  // Wallet-specific messages and tallies `accountsLinked`; the actual id
  // resolution and new-account creation is then delegated to
  // `createAccountsIfNeeded`.
  for (const account of importableAccounts) {
    const mapping = accountMapping[account.originalName]!;
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

  // Resolve every importable account to an app account id, creating new ones with a
  // zero starting balance (the imported rows build the balance up; the
  // user-entered target is restored in Phase 7). New-account currency comes from
  // the user-confirmed mapping; the fx reference date is the earliest CSV date.
  // `alwaysCreate` stays false because Wallet supports both link-existing and
  // create-new. `accountsCreated` counts only genuine inserts.
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

  // Phase 3: categories. Resolve each mapped category to an id via the shared
  // CSV resolver: link-existing verifies ownership, create-new finds-or-creates
  // by name (case-insensitive), and `categoriesCreated` counts only genuine
  // inserts. The transfer-marker category never appears in the mapping, so it is
  // never resolved nor created. Parsed categories the user left out of the
  // mapping resolve to nothing (`categoryNameToId.get` is undefined for them),
  // so those rows import without a category rather than being silently created.
  const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({ userId, categoryMapping });
  summary.categoriesCreated = categoriesCreated;

  // Phase 4: tags. Find-or-create each verbatim Wallet label, picking a random
  // colour per requested name for the create case. The shared helper batches the
  // existing-lookup and is fail-fast: a failing tag insert aborts the whole
  // import rather than being swallowed into `summary.errors`. Narrowed to labels
  // the surviving rows use so a skipped account leaves no orphan tag.
  const importableTagNames = new Set(importableTransactions.flatMap((tx) => tx.tags));
  const { tagIdByName, tagsCreated } = await createNamedTagsIfNeeded({
    userId,
    tags: parsed.tags
      .filter((tag) => importableTagNames.has(tag.name))
      .map((tag) => ({ name: tag.name, color: pickRandomColor() })),
  });
  summary.tagsCreated = tagsCreated;

  // Phase 4b: resolve every distinct non-empty `payee` (ordinary rows and
  // out-of-wallet legs) to a Payee id via the shared resolver — canonicalized
  // through the user's payee namespace, reused by canonical name or alias, else
  // inserted. `payeesCreated` counts genuine inserts only. Scans
  // `transactionsToWrite` (post-skip), so a payee confined to a skipped-duplicate
  // row creates no orphan Payee. Paired transfers carry no payee. Each id is
  // passed explicitly to `createTransaction` in Phase 5 (raw name kept as
  // `rawMerchantName`), so no merchant re-extraction runs there.
  const payeeNames = Array.from(
    new Set(
      transactionsToWrite
        .map((tx) => tx.payeeName)
        .filter((name): name is string => name != null && name.trim() !== ''),
    ),
  );
  const { payeeNameToId, payeesCreated } = await createPayeesIfNeeded({ userId, payeeNames });
  summary.payeesCreated = payeesCreated;

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
      logger.error({ message: '[Budget Bakers Wallet import] Progress callback failed', error: err as Error });
    }
  };

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

      // Direction comes from the parsed CSV `type`, not the sign of `amount`:
      // a zero-amount row has no sign (`-0 === 0`) yet still has a real
      // Expense/Income type the user expects to keep.
      const transactionType = tx.type;
      const amount = Money.fromDecimal(Math.abs(tx.amount));

      // Out-of-wallet legs carry no real category and model money leaving/entering
      // the tracked set of accounts, so they import as `transfer_out_wallet` with
      // no destination account and no category. Ordinary rows resolve their
      // category through the mapping; an unmapped name yields undefined (no
      // category), matching CSV behaviour.
      const categoryId = !tx.outOfWallet && tx.categoryName ? categoryNameToId.get(tx.categoryName) : undefined;
      // A row can carry several comma-separated Wallet labels; attach every one.
      // Any name without a resolved id (should not happen — all parsed tags are
      // created in Phase 4) is dropped; an empty result becomes undefined so the
      // row imports untagged rather than with an empty tag list.
      const resolvedTagIds = tx.tags
        .map((name) => tagIdByName.get(name))
        .filter((id): id is string => id !== undefined);
      const tagIds = resolvedTagIds.length > 0 ? resolvedTagIds : undefined;
      const hasImportedTags = tagIds !== undefined;
      const transferNature = tx.outOfWallet
        ? TRANSACTION_TRANSFER_NATURE.transfer_out_wallet
        : TRANSACTION_TRANSFER_NATURE.not_transfer;

      // Link the Phase 4b Payee explicitly (caller id wins over createTransaction's
      // extraction); `rawMerchantName` keeps the raw name, `payeeLocked` stays
      // false. An empty `payee` cell resolves to undefined → imports without a Payee.
      const payeeId = tx.payeeName ? payeeNameToId.get(tx.payeeName) : undefined;

      const createResult = await createTransaction({
        userId,
        accountId,
        amount,
        commissionRate: Money.zero(),
        note: tx.note,
        time: new Date(tx.date),
        transactionType,
        paymentType: mapBudgetBakersWalletPaymentType({ raw: tx.paymentType }),
        accountType: ACCOUNT_TYPES.system,
        transferNature,
        categoryId,
        tagIds,
        payeeId,
        rawMerchantName: tx.payeeName || null,
        externalData: { importDetails },
        // A category from the mapped Wallet column is authoritative and beats a
        // linked Payee's enforce/hint default. Inert when the row has no mapped
        // category, so Payee categorization still runs then.
        categoryIdIsExplicit: categoryId != null,
        matchPlanned: plannedMatchAccountIds.has(accountId),
      });
      const [transaction] = createResult;

      // Fold this committed row into the per-account balance tally IMMEDIATELY after
      // the commit, before any post-commit side-effect that can throw
      // (`applyPayeeDefaultTags` below): the balance hook has already moved
      // `currentBalance`, so a row missing from the tally would make the reconcile
      // adjustment too large with no desync error. Signed the way the hook applied it
      // (income adds, expense subtracts).
      reconciler.recordRow({
        accountId,
        rowIso: tx.date,
        ...signedRowContribution({
          isIncome: transactionType === TRANSACTION_TYPES.income,
          amount,
        }),
      });

      // A merged row is an existing planned transaction, not a newly imported
      // one, and it keeps the plan's own tag set.
      if (createResult.mergedIntoPlanned) {
        summary.merged += 1;
      } else {
        if (tx.outOfWallet) {
          summary.outOfWalletImported += 1;
        } else {
          summary.transactionsImported += 1;
        }

        // Union step: explicit `tagIds` made createTransaction skip the payee's
        // default tags, so re-apply them here on top of the imported set.
        // `applyPayeeDefaultTags` is add-only and dedupes, so both sets coexist.
        // The transaction is already committed, so a failure here loses only the
        // default tags and is reported as its own error — reporting it as a
        // failed row would invite a re-import that duplicates the transaction.
        if (transaction && hasImportedTags && transaction.payeeId) {
          try {
            await applyPayeeDefaultTags({
              accountOwnerUserId: userId,
              transactionId: transaction.id,
              payeeId: transaction.payeeId,
            });
          } catch (err) {
            logger.error({
              message: `[Budget Bakers Wallet import] Failed to apply default payee tags (row ${tx.rowIndex}, account "${tx.accountName}")`,
              error: err as Error,
            });
            summary.errors.push({
              rowIndex: tx.rowIndex,
              error: 'Transaction was imported, but the payee default tags could not be applied',
            });
          }
        }
      }
    } catch (err) {
      logger.error({
        message: `[Budget Bakers Wallet import] Failed to import transaction (row ${tx.rowIndex}, account "${tx.accountName}")`,
        error: err as Error,
      });
      summary.errors.push({
        rowIndex: tx.rowIndex,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    // Tick once per attempted row, regardless of success or failure, and OUTSIDE
    // the correctness try/catch: a progress/SSE error must not be recorded as a
    // fake per-row import error against a row that did commit, nor abort the run.
    await tick();
  }

  // Phase 6: transfers. A Wallet export records the exact amount on each side of
  // a transfer, so a cross-currency transfer carries a distinct source amount and
  // destination amount (e.g. 100 USD leaving, 92 EUR arriving). Both values are
  // passed straight through: `createTransaction` with `common_transfer` writes
  // the source (expense) and destination (income) legs and links them via
  // `transferId`.
  for (const xfer of transfersToWrite) {
    try {
      const sourceAccountId = accountIdByName.get(xfer.sourceAccountName);
      const destinationAccountId = accountIdByName.get(xfer.destinationAccountName);
      if (!sourceAccountId || !destinationAccountId) {
        throw new ValidationError({
          message: `Transfer references unknown account ("${xfer.sourceAccountName}" or "${xfer.destinationAccountName}").`,
        });
      }

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
    } catch (err) {
      logger.error({
        message: `[Budget Bakers Wallet import] Failed to import transfer ("${xfer.sourceAccountName}" → "${xfer.destinationAccountName}", rows ${xfer.rowIndices.join(', ')})`,
        error: err as Error,
      });
      const message = err instanceof Error ? err.message : 'Unknown error';
      // One error per leg so a user scanning by CSV line number can find both
      // halves of the failed transfer, not just the expense leg.
      for (const rowIndex of xfer.rowIndices) {
        summary.errors.push({ rowIndex, error: message });
      }
    }
    // Tick once per attempted transfer, regardless of success or failure, and
    // OUTSIDE the correctness try/catch: a progress/SSE error must not be
    // recorded as a fake import error nor abort the run.
    await tick();
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
    logLabel: 'Budget Bakers Wallet import',
  });
  summary.accountBalanceChanges.push(...accountBalanceChanges);
  summary.errors.push(...balanceErrors);

  return summary;
}

export const executeBudgetBakersWalletImport = withImportBatchRecord(executeBudgetBakersWalletImportImpl);
