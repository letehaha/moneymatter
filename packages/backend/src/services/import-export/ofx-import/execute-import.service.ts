import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  type AccountBalanceChange,
  ImportSource,
  type OfxAccountMapping,
  type OfxImportSummary,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionImportDetails,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import * as Transactions from '@models/transactions.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { type OpenImportBatch, withImportBatchRecord } from '@services/import-export/core/import-batch-record';
import { partitionReconcileAccounts } from '@services/import-export/core/partition-reconcile-accounts';
import { startBalanceReconciliation } from '@services/import-export/core/reconcile-account-balances';
import { createAccountsIfNeeded } from '@services/import-export/core/resolve/create-accounts-if-needed';
import { createPayeesIfNeeded } from '@services/import-export/core/resolve/create-payees-if-needed';
import { excludeSkippedAccounts } from '@services/import-export/core/resolve/exclude-skipped-accounts';
import { signedRowContribution } from '@services/import-export/core/signed-row-contribution';
import {
  buildSuppressedFailuresEntry,
  buildSystemicFailureMessage,
  createImportFailureTally,
  recordImportFailure,
  recordImportSuccess,
} from '@services/import-export/ms-money-import/import-error-collector';
import { createTransaction } from '@services/transactions';
import { selectAccountsWithPlannedRows } from '@services/transactions/planned-matching';
import { UniqueConstraintError } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import { deleteOfxUpload, readOfxUpload } from './upload-cache';

function resolveAccountCategory({ statementType, accountType }: { statementType: string; accountType: string }) {
  if (statementType === 'credit-card') return ACCOUNT_CATEGORIES.creditCard;
  const normalized = accountType.toUpperCase();
  if (normalized === 'SAVINGS' || normalized === 'MONEYMRKT') return ACCOUNT_CATEGORIES.saving;
  return ACCOUNT_CATEGORIES.currentAccount;
}

function resolvePaymentType({ transactionType }: { transactionType: string }): PAYMENT_TYPES {
  switch (transactionType.toUpperCase()) {
    case 'CHECK':
      return PAYMENT_TYPES.voucher;
    case 'ATM':
    case 'DEBIT':
    case 'DIRECTDEBIT':
    case 'POS':
      return PAYMENT_TYPES.debitCard;
    case 'CASH':
      return PAYMENT_TYPES.cash;
    case 'CREDIT':
      return PAYMENT_TYPES.creditCard;
    default:
      return PAYMENT_TYPES.bankTransfer;
  }
}

async function executeOfxImportImpl({
  userId,
  uploadId,
  accountMapping,
  skipDuplicateIndices,
  recalculateBalance = false,
  onProgress,
  openImportBatch,
}: {
  userId: number;
  uploadId: string;
  accountMapping: OfxAccountMapping;
  skipDuplicateIndices: number[];
  recalculateBalance?: boolean;
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
  openImportBatch: OpenImportBatch;
}): Promise<OfxImportSummary> {
  const parsed = await readOfxUpload({ userId, uploadId });
  const missing = parsed.accounts.filter((account) => !accountMapping[account.sourceAccountKey]);
  if (missing.length > 0) {
    throw new ValidationError({
      message: `Missing account mapping for: ${missing.map((a) => a.maskedDisplayName).join(', ')}`,
    });
  }

  const skippedKeys = new Set(
    parsed.accounts
      .filter((account) => accountMapping[account.sourceAccountKey]!.action === 'skip')
      .map((account) => account.sourceAccountKey),
  );
  const importableAccounts = parsed.accounts.filter((account) => !skippedKeys.has(account.sourceAccountKey));
  const mappingWithoutSkipped = excludeSkippedAccounts({ accountMapping });
  const accountByKey = new Map(parsed.accounts.map((account) => [account.sourceAccountKey, account]));

  const importDetails: TransactionImportDetails = {
    batchId: uuidv4(),
    importedAt: new Date().toISOString(),
    source: ImportSource.ofx,
  };
  const summary: OfxImportSummary & { accountBalanceChanges: AccountBalanceChange[] } = {
    batchId: importDetails.batchId,
    newTransactionIds: [],
    accountsCreated: 0,
    accountsLinked: 0,
    accountsSkipped: skippedKeys.size,
    payeesCreated: 0,
    transactionsImported: 0,
    duplicatesSkipped: 0,
    merged: 0,
    errors: [],
    accountBalanceChanges: [],
  };

  const currenciesToAdd = importableAccounts
    .filter((account) => accountMapping[account.sourceAccountKey]!.action === 'create-new')
    .map((account) => ({ userId, currencyCode: account.currency }));
  if (currenciesToAdd.length > 0) await addUserCurrencies(currenciesToAdd);

  for (const account of importableAccounts) {
    const mapping = accountMapping[account.sourceAccountKey]!;
    if (mapping.action === 'create-new') {
      if (mapping.currencyCode !== account.currency) {
        throw new ValidationError({ message: `Account ${account.maskedDisplayName} must use ${account.currency}.` });
      }
      continue;
    }
    if (mapping.action !== 'link-existing') continue;
    const existing = await Accounts.getAccountById({ userId, id: mapping.accountId });
    if (!existing)
      throw new ValidationError({ message: `Linked account for ${account.maskedDisplayName} was not found.` });
    if (existing.currencyCode !== account.currency) {
      throw new ValidationError({
        message: `Account ${account.maskedDisplayName} cannot be linked across currencies.`,
      });
    }
    summary.accountsLinked += 1;
  }

  const fxDate = parsed.dateRange ? new Date(parsed.dateRange.from) : new Date();
  const { accountNameToId: accountIdByKey, accountsCreated } = await createAccountsIfNeeded({
    userId,
    accountNames: importableAccounts.map((account) => account.sourceAccountKey),
    accountMapping: mappingWithoutSkipped,
    resolveCurrencyCode: (key) => accountByKey.get(key)?.currency,
    resolveFxDate: () => fxDate,
    resolveAccountName: (key) => {
      const mapping = accountMapping[key];
      return mapping?.action === 'create-new' ? mapping.name : accountByKey.get(key)!.suggestedLocalName;
    },
    resolveAccountCategory: (key) => resolveAccountCategory(accountByKey.get(key)!),
  });
  summary.accountsCreated = accountsCreated;

  const { capturedAccountIds, createdAccounts } = partitionReconcileAccounts({
    accountNameToId: accountIdByKey,
    accountMapping: mappingWithoutSkipped,
  });
  const importBatchId = await openImportBatch({
    userId,
    importDetails,
    createdAccountIds: createdAccounts.map((account) => account.accountId),
  });
  const reconciler = await startBalanceReconciliation({ userId, accountIds: capturedAccountIds });
  const plannedAccountIds = await selectAccountsWithPlannedRows({ accountIds: capturedAccountIds });

  const skipSet = new Set(skipDuplicateIndices);
  const rows = parsed.transactions.filter((tx) => !skippedKeys.has(tx.sourceAccountKey));
  const rowsToWrite = rows.filter((tx) => !skipSet.has(tx.rowIndex));
  if (onProgress) await onProgress(0, rowsToWrite.length);

  const payeeNames = Array.from(
    new Set(rowsToWrite.map((tx) => tx.payeeName?.trim()).filter((name): name is string => Boolean(name))),
  );
  const { payeeNameToId, payeesCreated } = await createPayeesIfNeeded({ userId, payeeNames });
  summary.payeesCreated = payeesCreated;

  const originalIds = rowsToWrite.map((tx) => tx.sourceTransactionKey).filter((id): id is string => Boolean(id));
  const existingIdRows =
    originalIds.length > 0
      ? await Transactions.getTransactionsByArrayOfField({ fieldName: 'originalId', fieldValues: originalIds, userId })
      : [];
  const existingKeys = new Set(existingIdRows.map((tx) => `${tx.accountId}:${tx.originalId}`));

  let processedCount = 0;
  let failureTally = createImportFailureTally();
  for (const tx of rows) {
    if (skipSet.has(tx.rowIndex)) {
      summary.duplicatesSkipped += 1;
      continue;
    }
    const accountId = accountIdByKey.get(tx.sourceAccountKey);
    if (!accountId) continue;
    if (tx.sourceTransactionKey && existingKeys.has(`${accountId}:${tx.sourceTransactionKey}`)) {
      summary.duplicatesSkipped += 1;
      processedCount += 1;
      if (onProgress) await onProgress(processedCount, rowsToWrite.length);
      continue;
    }

    try {
      const amount = Money.fromDecimal(tx.amount).abs();
      const result = await createTransaction({
        userId,
        accountId,
        amount,
        commissionRate: Money.zero(),
        note: tx.note,
        time: new Date(tx.date),
        transactionType: tx.type,
        paymentType: resolvePaymentType({ transactionType: tx.transactionType }),
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        payeeId: tx.payeeName ? payeeNameToId.get(tx.payeeName.trim()) : undefined,
        rawMerchantName: tx.payeeName,
        originalId: tx.sourceTransactionKey,
        externalData: {
          importDetails,
          ofx: {
            transactionType: tx.transactionType,
            checkNumber: tx.checkNumber,
            referenceNumber: tx.referenceNumber,
          },
        },
        matchPlanned: plannedAccountIds.has(accountId),
      });

      reconciler.recordRow({
        accountId,
        rowIso: tx.date,
        ...signedRowContribution({ isIncome: tx.type === TRANSACTION_TYPES.income, amount }),
      });
      if (result.mergedIntoPlanned) summary.merged += 1;
      else {
        summary.transactionsImported += 1;
        summary.newTransactionIds.push(result[0].id);
      }
      if (tx.sourceTransactionKey) existingKeys.add(`${accountId}:${tx.sourceTransactionKey}`);
      failureTally = recordImportSuccess({ tally: failureTally });
    } catch (error) {
      if (error instanceof UniqueConstraintError && tx.sourceTransactionKey) {
        summary.duplicatesSkipped += 1;
      } else {
        const decision = recordImportFailure({ tally: failureTally, rowIndices: [tx.rowIndex] });
        failureTally = decision.tally;
        if (decision.shouldLog) {
          logger.error({ message: `[OFX import] Failed row ${tx.rowIndex}`, error: error as Error });
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        for (const rowIndex of decision.retainedRowIndices) summary.errors.push({ rowIndex, error: message });
        if (decision.shouldAbort) {
          throw new UnexpectedError({ message: buildSystemicFailureMessage({ lastError: error }) });
        }
      }
    }
    processedCount += 1;
    if (onProgress) await onProgress(processedCount, rowsToWrite.length);
  }

  const suppressedFailuresEntry = buildSuppressedFailuresEntry({ tally: failureTally });
  if (suppressedFailuresEntry) summary.errors.push(suppressedFailuresEntry);
  if (failureTally.unloggedFailures > 0) {
    logger.error({
      message: `[OFX import] ${failureTally.unloggedFailures} further row failures were not logged individually`,
    });
  }

  const { accountBalanceChanges, errors } = await reconciler.finalize({
    importBatchId,
    recalculateBalance,
    createdAccounts,
    logLabel: 'OFX import',
  });
  summary.accountBalanceChanges.push(...accountBalanceChanges);
  summary.errors.push(...errors);

  try {
    await deleteOfxUpload({ userId, uploadId });
  } catch (error) {
    logger.error({ message: '[OFX import] Failed to delete cached upload', error: error as Error });
  }
  return summary;
}

export const executeOfxImport = withImportBatchRecord(executeOfxImportImpl);
