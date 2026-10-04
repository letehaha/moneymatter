import {
  ACCOUNT_TYPES,
  ImportSource,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  YNAB_FLAG_HEX,
  type TransactionImportDetails,
  type YnabAccountMapping,
  type YnabFlagColor,
  type YnabImportSummary,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Payees from '@models/payees.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { normalizePayeeName } from '@services/payees/normalize-name';
import { createPayee } from '@services/payees/payees.service';
import { createTransaction } from '@services/transactions';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import { type OpenImportBatch, withImportBatchRecord } from '../core/import-batch-record';
import { createAccountsIfNeeded } from '../core/resolve/create-accounts-if-needed';
import { createTwoLevelCategoriesIfNeeded } from '../core/resolve/create-categories-if-needed';
import { createNamedTagsIfNeeded } from '../core/resolve/create-tags-if-needed';
import { collectCategories, collectPayees, collectTagsUsed, parseYnabRegister } from './parse-ynab.service';

/** User-facing tag name for each flag color. */
function flagToTagName(color: YnabFlagColor): string {
  return `YNAB ${color.charAt(0).toUpperCase()}${color.slice(1)}`;
}

interface ExecuteYnabImportParams {
  userId: number;
  fileContent: string;
  accountMapping: YnabAccountMapping;
  /** Called with cumulative `processedCount` after each transaction commit so
   *  the BullMQ worker can fan progress out over SSE. Optional — safe to omit
   *  in tests or one-shot callers. */
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
  openImportBatch: OpenImportBatch;
}

/**
 * One-shot writer for a parsed YNAB Register.csv. Runs OUTSIDE a wrapping
 * transaction so a single bad row does not nuke the whole import — partial
 * success is the contract documented for the user. Each helper (account /
 * category / payee / tag creation, individual transaction insert) still runs
 * inside its own `withTransaction` further down the call stack.
 */
async function executeYnabImportImpl({
  userId,
  fileContent,
  accountMapping,
  onProgress,
  openImportBatch,
}: ExecuteYnabImportParams): Promise<YnabImportSummary> {
  const parsed = parseYnabRegister({ fileContent });
  const batchId = uuidv4();
  const importedAt = new Date().toISOString();

  // Validate every distinct account name in the parser output has a mapping.
  // Skipped accounts need one too: `skip` is an explicit entry, not an omission.
  const missingMappings = parsed.accounts.filter((a) => !accountMapping[a.originalName]);
  if (missingMappings.length > 0) {
    throw new ValidationError({
      message: `Missing account mapping for: ${missingMappings.map((a) => a.originalName).join(', ')}`,
    });
  }

  const skippedAccountNames = new Set(
    parsed.accounts.filter((a) => accountMapping[a.originalName]!.skip).map((a) => a.originalName),
  );
  const importableAccounts = parsed.accounts.filter((a) => !skippedAccountNames.has(a.originalName));
  const transactionsToWrite = parsed.transactions.filter((tx) => !skippedAccountNames.has(tx.accountName));
  const transfersToWrite = parsed.transfers.filter(
    (xfer) => !skippedAccountNames.has(xfer.sourceAccountName) && !skippedAccountNames.has(xfer.destinationAccountName),
  );

  // Re-derive from the surviving rows: the parser's file-wide lists would create
  // categories, payees and tags that no imported row references.
  const categoriesToCreate = collectCategories({ transactions: transactionsToWrite });
  const payeesToCreate = collectPayees({ transactions: transactionsToWrite });
  const tagsToCreate = collectTagsUsed({ transactions: transactionsToWrite, transfers: transfersToWrite });

  const summary: YnabImportSummary = {
    accountsCreated: 0,
    accountsSkipped: skippedAccountNames.size,
    categoriesCreated: 0,
    payeesCreated: 0,
    tagsCreated: 0,
    transactionsImported: 0,
    transfersImported: 0,
    splitsDetected: 0,
    errors: [],
  };

  const totalCount = transactionsToWrite.length + transfersToWrite.length;
  // Stable `importDetails` blob attached to every created row — same batch for
  // every loop iteration, so build it once and share by reference.
  const importDetails: TransactionImportDetails = {
    batchId,
    importedAt,
    source: ImportSource.ynab,
  };
  // Convert starting balances at the earliest CSV date, not today — YNAB
  // exports span years and using today's FX rate would skew refInitialBalance
  // by however much the currency has moved since the account opened. Fall back
  // to today only when the parser found no usable dates at all.
  const initialBalanceFxDate = parsed.dateRange ? parseIsoToDate(parsed.dateRange.from) : new Date();

  // Phase 1: bootstrap currencies.
  const currencyCodes = new Set<string>();
  for (const a of importableAccounts) {
    currencyCodes.add(accountMapping[a.originalName]!.currencyCode);
  }
  if (currencyCodes.size > 0) {
    await addUserCurrencies(Array.from(currencyCodes).map((currencyCode) => ({ userId, currencyCode })));
  }

  // Phase 2: accounts (Map<ynabName, accountId>). Every YNAB account always
  // creates a fresh app account — the wizard never links into an existing one,
  // so users get an isolated import that's safe to delete wholesale if they
  // want to re-import. `alwaysCreate` bypasses the link-existing path entirely;
  // currency comes from the per-account mapping and the starting balance is
  // converted at the earliest CSV date via `initialBalanceFxDate`.
  const startingBalanceCentsByName = new Map<string, number>();
  for (const ynabAccount of importableAccounts) {
    startingBalanceCentsByName.set(ynabAccount.originalName, Money.fromDecimal(ynabAccount.startingBalance).toCents());
  }
  const { accountNameToId: accountIdByName, accountsCreated } = await createAccountsIfNeeded({
    userId,
    accountNames: importableAccounts.map((a) => a.originalName),
    accountMapping: {},
    alwaysCreate: true,
    resolveCurrencyCode: (accountName) => accountMapping[accountName]?.currencyCode,
    resolveFxDate: () => initialBalanceFxDate,
    resolveInitialBalanceCents: (accountName) => startingBalanceCentsByName.get(accountName) ?? 0,
  });
  summary.accountsCreated = accountsCreated;

  await openImportBatch({
    userId,
    importDetails,
    createdAccountIds: Array.from(accountIdByName.values()),
  });

  // Phase 3: categories. YNAB "Bills > Taxes" becomes parent "Bills" + child
  // "Taxes" under it. Existing same-named categories on the user are reused
  // instead of duplicated. The two-level helper batches the lookups (one query
  // per level) so an import with dozens of categories doesn't issue a roundtrip
  // per name, and keys the result by the parser's `fullName` — the same key the
  // transaction loop builds as `${categoryGroup}: ${categoryName}`.
  const { categoryIdByFullName: categoryByFullName, categoriesCreated } = await createTwoLevelCategoriesIfNeeded({
    userId,
    categories: categoriesToCreate.map((c) => ({
      groupName: c.groupName,
      categoryName: c.categoryName,
      fullName: c.fullName,
    })),
  });
  summary.categoriesCreated = categoriesCreated;

  // Phase 4: payees. Find-or-create on normalized name, with a single batched
  // lookup for everything that already exists.
  const payeeByName = new Map<string, string>();
  const normalizedByPayeeName = new Map<string, string>();
  for (const payee of payeesToCreate) {
    const normalized = normalizePayeeName({ raw: payee.name });
    if (normalized) normalizedByPayeeName.set(payee.name, normalized);
  }
  const payeeIdByNormalized = new Map<string, string>();
  if (normalizedByPayeeName.size > 0) {
    const existingPayees = await Payees.findAll({
      where: { userId, normalizedName: { [Op.in]: Array.from(new Set(normalizedByPayeeName.values())) } },
    });
    for (const payee of existingPayees) {
      payeeIdByNormalized.set(payee.normalizedName, payee.id);
    }
  }
  for (const [payeeName, normalized] of normalizedByPayeeName) {
    const existingId = payeeIdByNormalized.get(normalized);
    if (existingId) {
      payeeByName.set(payeeName, existingId);
      continue;
    }
    try {
      const created = await createPayee({ userId, name: payeeName });
      payeeByName.set(payeeName, created.id);
      // Two raw names can normalize to the same payee; reuse the created row.
      payeeIdByNormalized.set(normalized, created.id);
      summary.payeesCreated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ message: `[YNAB import] Failed to create payee "${payeeName}"`, error: err as Error });
      // Surface in summary.errors so the done-step callout tells the user the
      // payee was dropped — transactions referencing it will land without a
      // payeeId rather than fail. rowIndex is -1 because the failure spans
      // every row that used this payee, not a single CSV line.
      summary.errors.push({ rowIndex: -1, error: `Failed to create payee "${payeeName}": ${message}` });
    }
  }

  // Phase 5: tags. Each YNAB flag color maps to a verbatim tag name (its flag
  // color, hex from `YNAB_FLAG_HEX`). The shared helper find-or-creates them in
  // one batched lookup and keys the result by tag name; rebuild the
  // color → id map the row loops use from that.
  const { tagIdByName, tagsCreated } = await createNamedTagsIfNeeded({
    userId,
    tags: tagsToCreate.map((t) => ({ name: flagToTagName(t.color), color: YNAB_FLAG_HEX[t.color] })),
  });
  summary.tagsCreated = tagsCreated;

  const tagByColor = new Map<YnabFlagColor, string>();
  for (const tagUsage of tagsToCreate) {
    tagByColor.set(tagUsage.color, tagIdByName.get(flagToTagName(tagUsage.color))!);
  }

  let processedCount = 0;
  const tick = async () => {
    processedCount += 1;
    if (onProgress) await onProgress(processedCount, totalCount);
  };

  // Phase 6: transactions.
  for (const tx of transactionsToWrite) {
    try {
      const accountId = accountIdByName.get(tx.accountName);
      if (!accountId) throw new ValidationError({ message: `Unknown account "${tx.accountName}"` });

      const isExpense = tx.amount < 0;
      const transactionType = isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
      const amount = Money.fromDecimal(Math.abs(tx.amount));

      const categoryId =
        tx.categoryGroup && tx.categoryName
          ? categoryByFullName.get(`${tx.categoryGroup}: ${tx.categoryName}`)
          : undefined;
      const payeeId = tx.payeeName ? payeeByName.get(tx.payeeName) : undefined;
      const tagIds = tx.flag && tagByColor.has(tx.flag) ? [tagByColor.get(tx.flag)!] : undefined;

      await createTransaction({
        userId,
        accountId,
        amount,
        commissionRate: Money.zero(),
        note: tx.memo,
        time: parseIsoToDate(tx.date),
        transactionType,
        paymentType: PAYMENT_TYPES.creditCard,
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        categoryId,
        categoryIdIsExplicit: categoryId != null,
        payeeId,
        tagIds,
        externalData: { importDetails },
      });

      summary.transactionsImported += 1;
      await tick();
    } catch (err) {
      summary.errors.push({
        rowIndex: tx.rowIndex,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      await tick();
    }
  }

  // Phase 7: transfers. Use createTransaction with `common_transfer` so the
  // service writes both legs and links them via `transferId`.
  for (const xfer of transfersToWrite) {
    try {
      const sourceAccountId = accountIdByName.get(xfer.sourceAccountName);
      const destinationAccountId = accountIdByName.get(xfer.destinationAccountName);
      if (!sourceAccountId || !destinationAccountId) {
        throw new ValidationError({
          message: `Transfer references unknown account ("${xfer.sourceAccountName}" or "${xfer.destinationAccountName}").`,
        });
      }

      const tagIds = xfer.flag && tagByColor.has(xfer.flag) ? [tagByColor.get(xfer.flag)!] : undefined;
      const amount = Money.fromDecimal(xfer.amount);

      // YNAB CSV doesn't surface a separate destination amount even when the
      // two accounts have different currencies — they ALWAYS round-trip the
      // amount cell for both legs. When currencies differ we keep the same
      // numeric amount on both sides; users can fix individual cross-currency
      // transfers post-import.
      const destinationAmount = amount;

      await createTransaction({
        userId,
        accountId: sourceAccountId,
        amount,
        commissionRate: Money.zero(),
        note: xfer.memo,
        time: parseIsoToDate(xfer.date),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: PAYMENT_TYPES.creditCard,
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId,
        destinationAmount,
        tagIds,
        externalData: { importDetails },
      });

      summary.transfersImported += 1;
      await tick();
    } catch (err) {
      summary.errors.push({
        rowIndex: xfer.rowIndices[0],
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      await tick();
    }
  }

  // Detected splits are reported informationally — every child row was already
  // imported via the transactions loop above. Used by the wizard's results
  // screen to nudge users toward manual cleanup if their YNAB had splits.
  summary.splitsDetected = parsed.detectedSplitCount;

  return summary;
}

export const executeYnabImport = withImportBatchRecord(executeYnabImportImpl);

function parseIsoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
