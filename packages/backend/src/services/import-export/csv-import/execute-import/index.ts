import type {
  AccountMappingConfig,
  CategoryMappingConfig,
  CsvImportSummary,
  ImportError,
  ParsedTransactionRow,
  TagMappingConfig,
  TransactionImportDetails,
} from '@bt/shared/types';
import {
  ACCOUNT_TYPES,
  ImportSource,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { trackImportCompleted } from '@js/utils/posthog';
import * as Accounts from '@models/accounts.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { type OpenImportBatch, withImportBatchRecord } from '@services/import-export/core/import-batch-record';
import { partitionReconcileAccounts } from '@services/import-export/core/partition-reconcile-accounts';
import { startBalanceReconciliation } from '@services/import-export/core/reconcile-account-balances';
import { createAccountsIfNeeded } from '@services/import-export/core/resolve/create-accounts-if-needed';
import { createCategoriesIfNeeded } from '@services/import-export/core/resolve/create-categories-if-needed';
import { createPayeesIfNeeded } from '@services/import-export/core/resolve/create-payees-if-needed';
import { createTagsIfNeeded } from '@services/import-export/core/resolve/create-tags-if-needed';
import { excludeSkippedAccounts } from '@services/import-export/core/resolve/exclude-skipped-accounts';
import { resolveRowTagIds } from '@services/import-export/core/resolve/resolve-row-tag-ids';
import { signedRowContribution } from '@services/import-export/core/signed-row-contribution';
import { applyPayeeDefaultTags } from '@services/payees/apply-default-tags';
import { createTransaction } from '@services/transactions';
import { selectAccountsWithPlannedRows } from '@services/transactions/planned-matching';
import { v4 as uuidv4 } from 'uuid';

interface ExecuteImportParams {
  userId: number;
  validRows: ParsedTransactionRow[];
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  /**
   * Per distinct source tag string, the action chosen by the user. Absent when
   * no tag column was mapped, in which case no tags are applied.
   */
  tagMapping?: TagMappingConfig;
  skipDuplicateIndices: number[];
  /**
   * Row indices for unpriceable rows the user chose to skip. Merged into the
   * same skip set as skipDuplicateIndices so they share the same rowIndex space.
   */
  skipUnpriceableIndices?: number[];
  defaultAccountId?: string;
  defaultCategoryId?: string;
  /**
   * When true, rows dated on/after a linked account's pre-import boundary (day
   * of its latest existing transaction) move that account's current balance;
   * older rows are absorbed into `initialBalance`. When false/absent, every
   * linked account keeps its pre-import balance. Applies only to link-existing
   * accounts — created accounts derive their balance from the entered
   * `currentBalance` target / imported rows.
   */
  recalculateBalance?: boolean;
  /**
   * Called with the cumulative `processedCount` after each successfully created
   * transaction so the BullMQ worker can fan progress out over SSE. `totalCount`
   * is the number of rows that will actually be imported (`rowsToImport.length`).
   * Optional — safe to omit in tests or one-shot callers.
   */
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
  openImportBatch: OpenImportBatch;
}

function pickReferenced<T>({ mapping, referenced }: { mapping: Record<string, T>; referenced: Set<string> }) {
  return Object.fromEntries(Object.entries(mapping).filter(([sourceName]) => referenced.has(sourceName)));
}

/**
 * Execute a CSV import. Runs OUTSIDE a wrapping transaction so a single bad row
 * does not nuke the whole import — best-effort partial success is the contract
 * the user sees. Each row's `createTransaction` opens its own transaction, so a
 * row that fails at the database layer rolls back only itself and is reported in
 * `summary.errors`; the rows around it still commit. The up-front currency,
 * account, category, and tag creation each wrap themselves in `withTransaction`
 * further down the call stack, so they commit independently of the row loop too.
 */
async function executeImportImpl({
  userId,
  validRows,
  accountMapping,
  categoryMapping,
  tagMapping,
  skipDuplicateIndices,
  skipUnpriceableIndices,
  defaultAccountId,
  defaultCategoryId,
  recalculateBalance = false,
  onProgress,
  openImportBatch,
}: ExecuteImportParams): Promise<CsvImportSummary> {
  const batchId = uuidv4();
  const importDetails: TransactionImportDetails = {
    batchId,
    importedAt: new Date().toISOString(),
    source: ImportSource.csv,
  };

  // Merge duplicate and unpriceable skip indices into one set so both are
  // filtered with a single pass. Both sets use the same rowIndex space as
  // ParsedTransactionRow.rowIndex and DetectDuplicatesResponse.unpriceableRows.
  const skipSet = new Set([...skipDuplicateIndices, ...(skipUnpriceableIndices ?? [])]);

  // Narrowed to names the parsed file actually contains so `accountsSkipped`
  // counts real accounts rather than stale mapping keys the client kept around.
  const accountNamesInFile = new Set(validRows.map((row) => row.accountName));
  const skippedAccountNames = new Set(
    Object.entries(accountMapping)
      .filter(([accountName, mapping]) => mapping.action === 'skip' && accountNamesInFile.has(accountName))
      .map(([accountName]) => accountName),
  );

  const importableMapping = excludeSkippedAccounts({ accountMapping });

  const rowsToImport = validRows.filter(
    (row) => !skipSet.has(row.rowIndex) && !skippedAccountNames.has(row.accountName),
  );

  // Count each skipped row exactly once: `skipped` owns confirmed duplicates;
  // `skippedUnpriceable` owns rows that are unpriceable but not also duplicates.
  // A row in both sets is already counted under `skipped`, so excluding the
  // duplicate-skip set from the unpriceable count prevents double-counting.
  // Rows on a skipped account are in neither count: `accountsSkipped` covers them.
  const dupSkipSet = new Set(skipDuplicateIndices);
  const skippedUnpriceableCount = (skipUnpriceableIndices ?? []).filter((i) => !dupSkipSet.has(i)).length;

  // Report the real total once up front so a no-op import still surfaces its
  // total and the worker reports the correct `totalCount` instead of 0.
  if (onProgress) await onProgress(0, rowsToImport.length);

  if (rowsToImport.length === 0) {
    return {
      imported: 0,
      merged: 0,
      skipped: skipDuplicateIndices.length,
      skippedUnpriceable: skippedUnpriceableCount,
      accountsCreated: 0,
      accountsSkipped: skippedAccountNames.size,
      categoriesCreated: 0,
      tagsCreated: 0,
      payeesCreated: 0,
      errors: [],
      newTransactionIds: [],
      batchId,
      accountBalanceChanges: [],
    };
  }

  // Link-existing mappings must match the linked account's currency, checked
  // BEFORE any side effect (currency bootstrap, account creation, row writes)
  // so a failed import leaves zero state. A transaction's currency always
  // comes from the account it lands on, so a USD row posted to a EUR account
  // would keep its number and silently change meaning (100 USD booked as
  // 100 EUR) — and balance reconciliation would then stamp that wrong amount
  // into the account balance. Mirrors the Wallet importer's identical guard.
  // The `defaultAccountId` fallback (rows with no per-name mapping) is
  // deliberately exempt: the wizard's single-existing-account flow warns about
  // the currency coercion up front and imports in the account's currency.
  const currencyMismatches: string[] = [];
  for (const accountName of new Set(rowsToImport.map((r) => r.accountName))) {
    const mapping = accountMapping[accountName];
    if (mapping?.action !== 'link-existing') continue;

    // A missing/foreign account id fails later in `createAccountsIfNeeded`
    // with its own actionable error; this guard only owns the currency check.
    const account = await Accounts.getAccountById({ userId, id: mapping.accountId });
    if (!account) continue;

    const rowCurrencies = new Set(rowsToImport.filter((r) => r.accountName === accountName).map((r) => r.currencyCode));
    const mismatched = Array.from(rowCurrencies).filter((code) => code !== account.currencyCode);
    if (mismatched.length > 0) {
      currencyMismatches.push(
        `"${accountName}" (${mismatched.join(', ')}) cannot be linked to "${account.name}" (${account.currencyCode})`,
      );
    }
  }
  if (currencyMismatches.length > 0) {
    throw new ValidationError({
      message: `Currencies must match to link an existing account: ${currencyMismatches.join('; ')}. Link an account with the same currency or create a new one.`,
    });
  }

  // Collect unique currencies from rows to import
  const uniqueCurrencies = new Set(rowsToImport.map((r) => r.currencyCode));

  // Add all currencies to user's currencies
  await addUserCurrencies(Array.from(uniqueCurrencies).map((code) => ({ userId, currencyCode: code })));

  // Create accounts that need to be created. Currency for a new account comes
  // from the first row that uses it; the fx reference date is "now" to preserve
  // the prior behavior. A created account starts at a zero initial balance —
  // the imported rows build its balance up, and the user-entered
  // `currentBalance` target (when present) is forced in `finalize` afterwards.
  const uniqueAccountNames = Array.from(new Set(rowsToImport.map((r) => r.accountName)));
  const { accountNameToId, accountsCreated } = await createAccountsIfNeeded({
    userId,
    accountNames: uniqueAccountNames,
    accountMapping: importableMapping,
    resolveCurrencyCode: (accountName) => rowsToImport.find((r) => r.accountName === accountName)?.currencyCode,
    resolveFxDate: () => new Date(),
    defaultAccountId,
  });

  // Snapshot every pre-existing account the rows will land on (link-existing
  // mappings AND the defaultAccountId fallback) BEFORE any row is written:
  // balance-before + boundary day. Accounts created above are excluded — they
  // have no history to protect, so the recalculate flag does not apply to them
  // (they are handed to `finalize` for their summary entries instead).
  const { capturedAccountIds, createdAccounts } = partitionReconcileAccounts({
    accountNameToId,
    accountMapping: importableMapping,
  });
  const importBatchId = await openImportBatch({
    userId,
    importDetails,
    createdAccountIds: createdAccounts.map((account) => account.accountId),
  });
  const reconciler = await startBalanceReconciliation({ userId, accountIds: capturedAccountIds });

  const plannedMatchAccountIds = await selectAccountsWithPlannedRows({ accountIds: capturedAccountIds });

  // Resolve only the entities the surviving rows reference. A mapping entry for a
  // skipped account's value, or one the client kept from an earlier column choice,
  // would create a category or tag nothing points at.
  const referencedCategoryNames = new Set(rowsToImport.flatMap((row) => row.categoryName ?? []));
  const referencedTagNames = new Set(rowsToImport.flatMap((row) => row.tagNames ?? []));

  // Resolve categories that need to be created or linked. `categoriesCreated`
  // counts only genuine inserts — create-new entries that matched an existing
  // same-named category (case-insensitive) link to it instead.
  const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({
    userId,
    categoryMapping: pickReferenced({ mapping: categoryMapping, referenced: referencedCategoryNames }),
  });

  // Resolve tags that need to be created or linked. `tagsCreated` counts only
  // genuine inserts — create-new entries that matched an existing same-named
  // tag (case-insensitive) link to it instead.
  const { tagNameToId, tagsCreated } = tagMapping
    ? await createTagsIfNeeded({
        userId,
        tagMapping: pickReferenced({ mapping: tagMapping, referenced: referencedTagNames }),
      })
    : { tagNameToId: new Map<string, string>(), tagsCreated: 0 };

  // Resolve Payees for every mapped merchant string up front. `payeesCreated`
  // counts only genuine inserts (a raw string matching an existing Payee by
  // canonical name or alias reuses it); the map is keyed by the verbatim source
  // string so each row looks its id up directly.
  const uniquePayeeNames = Array.from(
    new Set(rowsToImport.map((r) => r.payeeName).filter((name): name is string => !!name && name.trim().length > 0)),
  );
  const { payeeNameToId, payeesCreated } = await createPayeesIfNeeded({
    userId,
    payeeNames: uniquePayeeNames,
  });

  // Create transactions
  const errors: ImportError[] = [];
  const newTransactionIds: string[] = [];
  let mergedCount = 0;

  let processedCount = 0;
  const tick = async () => {
    processedCount += 1;
    if (!onProgress) return;
    // Progress reporting is a best-effort side-effect (it fans out over SSE). A
    // failure here must never reject the import nor be attributed to a row, so
    // it is contained and logged rather than propagated. The count is already
    // advanced above, so a dropped tick does not desync the final total.
    try {
      await onProgress(processedCount, rowsToImport.length);
    } catch (err) {
      logger.error({ message: '[CSV import] Progress callback failed', error: err as Error });
    }
  };

  for (const row of rowsToImport) {
    try {
      const accountId = accountNameToId.get(row.accountName);
      if (!accountId) {
        errors.push({
          rowIndex: row.rowIndex,
          error: `Account "${row.accountName}" could not be resolved`,
        });
        continue;
      }

      // A category from the mapped column is the user's explicit per-row choice
      // and beats a linked Payee's enforce/hint default (`categoryIdIsExplicit`
      // below). A row that only falls back to `defaultCategoryId` is NOT explicit,
      // so a Payee rule may still categorize it — hence the flag keys off
      // `mappedCategoryId`, not `categoryId`.
      const mappedCategoryId = row.categoryName ? categoryNameToId.get(row.categoryName) : undefined;
      const categoryId = mappedCategoryId ?? defaultCategoryId;

      // Payee resolved up front; passed explicitly so createTransaction links it
      // instead of re-extracting from `rawMerchantName`. `payeeLocked` stays at
      // its default — an import-assigned Payee stays user-overridable.
      const payeeId = row.payeeName ? payeeNameToId.get(row.payeeName) : undefined;

      // Resolve the imported tags for this row: source names mapped to ids,
      // deduped (distinct names can resolve to the same id; a name can repeat
      // in the cell). Empty when the row carried no mapped tags.
      const rowTagIds = resolveRowTagIds({ tagNames: row.tagNames, tagNameToId });
      const hasImportedTags = rowTagIds.length > 0;

      const rowAmount = Money.fromCents(row.amount);

      // Service-layer createTransaction handles refAmount + currency from the
      // account, plus Payee extraction + payee_rule via `rawMerchantName` when
      // the user mapped a Payee column. Without this path the imported row
      // would arrive at AI with `categorizationMeta = null` and bypass any
      // Payee defaults the user has already set up.
      //
      // Passing `tagIds` makes createTransaction treat the row as having a
      // caller-decided tag set: it writes exactly those tags and skips its own
      // payee-default-tags step. To keep imported tags and payee defaults as a
      // UNION, this path re-applies the payee defaults additively below. When
      // the row has no imported tags, `tagIds` stays undefined so
      // createTransaction's built-in payee-default application runs unchanged.
      const createResult = await createTransaction({
        userId,
        amount: rowAmount,
        commissionRate: Money.zero(),
        note: row.description,
        time: new Date(row.date),
        transactionType: row.transactionType === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        paymentType: PAYMENT_TYPES.creditCard,
        accountId,
        categoryId: categoryId || undefined,
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        externalData: {
          importDetails,
        },
        rawMerchantName: row.payeeName || null,
        payeeId: payeeId || undefined,
        tagIds: hasImportedTags ? rowTagIds : undefined,
        categoryIdIsExplicit: Boolean(mappedCategoryId),
        matchPlanned: plannedMatchAccountIds.has(accountId),
      });
      const [transaction] = createResult;

      if (transaction) {
        // Fold this committed row into the per-account balance tally IMMEDIATELY
        // after the commit, before any post-commit step that can throw: the
        // balance hook has already moved `currentBalance`, so a row missing from
        // the tally would make the reconcile adjustment too large with no desync
        // error. Signed the way the hook applied it (income adds, expense
        // subtracts).
        reconciler.recordRow({
          accountId,
          rowIso: row.date,
          ...signedRowContribution({
            isIncome: row.transactionType === 'income',
            amount: rowAmount,
          }),
        });

        // A merged row is an existing planned transaction, not a new one: it
        // stays out of `newTransactionIds` and keeps the plan's own tag set.
        if (createResult.mergedIntoPlanned) {
          mergedCount += 1;
        } else {
          newTransactionIds.push(transaction.id);

          // Union step: when the row supplied its own tags, createTransaction did
          // not apply the payee's default tags (the explicit tagIds short-circuit
          // that). Add them here on top of the imported set — `applyPayeeDefaultTags`
          // is add-only and skips duplicates, so imported tags and payee defaults
          // coexist. The payeeId was resolved by createTransaction (caller-supplied
          // or extracted from `rawMerchantName`). The transaction is already
          // committed, so a failure here loses only the default tags and is
          // reported as its own error — reporting it as a failed row would invite
          // a re-import that duplicates the transaction.
          if (hasImportedTags && transaction.payeeId) {
            try {
              await applyPayeeDefaultTags({
                accountOwnerUserId: userId,
                transactionId: transaction.id,
                payeeId: transaction.payeeId,
              });
            } catch (err) {
              logger.error({
                message: `[CSV import] Failed to apply default payee tags (row ${row.rowIndex})`,
                error: err as Error,
              });
              errors.push({
                rowIndex: row.rowIndex,
                error: 'Transaction was imported, but the payee default tags could not be applied',
              });
            }
          }
        }
      } else {
        // createTransaction's read-back is typed non-nullable, so this branch is
        // unreachable through the current types. If it ever fires, the insert
        // committed (a throw would have hit the catch below) while the row
        // escaped `newTransactionIds` AND the balance tally (its `refAmount` is
        // unknowable without the read-back) — surface it loudly instead of
        // letting the row silently vanish from the imported count.
        logger.error({
          message: `[CSV import] createTransaction returned no transaction for committed row ${row.rowIndex}`,
        });
        errors.push({
          rowIndex: row.rowIndex,
          error: 'Transaction was created but could not be read back; it is missing from the imported count',
        });
      }

      // Tick once per committed row, OUTSIDE the correctness path above: a
      // progress/SSE error must not be recorded as a fake per-row import
      // error against a row that did commit, nor abort the run.
      await tick();
    } catch (error) {
      errors.push({
        rowIndex: row.rowIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Back-adjust each pre-existing account (the hook moved `currentBalance` by
  // every written row; `finalize` removes what must not stay applied — backfill
  // with recalc ON, everything with it OFF). For accounts this import created,
  // the user-entered `currentBalance` (when present) is forced as the final
  // balance — the difference from the imported rows' net is absorbed into
  // `initialBalance`; a null/absent value leaves the balance at Σ(imported
  // rows). Either way `finalize` emits their summary entries. A failed balance
  // write surfaces as an `account-balance-desync` error instead of failing the
  // import — the rows are already committed.
  const { accountBalanceChanges, errors: balanceErrors } = await reconciler.finalize({
    importBatchId,
    recalculateBalance,
    createdAccounts,
    logLabel: 'CSV import',
  });
  errors.push(...balanceErrors);

  // Track analytics event
  if (newTransactionIds.length > 0) {
    trackImportCompleted({
      userId,
      importType: 'csv',
      transactionsCount: newTransactionIds.length,
    });
  }

  return {
    imported: newTransactionIds.length,
    merged: mergedCount,
    skipped: skipDuplicateIndices.length,
    skippedUnpriceable: skippedUnpriceableCount,
    accountsCreated,
    accountsSkipped: skippedAccountNames.size,
    categoriesCreated,
    tagsCreated,
    payeesCreated,
    errors,
    newTransactionIds,
    batchId,
    accountBalanceChanges,
  };
}

export const executeImport = withImportBatchRecord(executeImportImpl);
