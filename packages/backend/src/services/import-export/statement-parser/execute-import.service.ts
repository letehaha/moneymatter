import { parseImportDate } from '@bt/shared/import-export/date-engine';
import type {
  ExtractedTransaction,
  StatementImportError,
  StatementImportSummary,
  TransactionImportDetails,
} from '@bt/shared/types';
import {
  ACCOUNT_TYPES,
  CATEGORIZATION_TRIGGER,
  ImportSource,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import { trackImportCompleted } from '@js/utils/posthog';
import * as Accounts from '@models/accounts.model';
import { getCurrencies } from '@models/currencies.model';
import * as Users from '@models/users.model';
import { assertNotDerivedBalanceAccount } from '@services/accounts/derived-balance-guard';
import { CATEGORIZATION_SCOPE, queueCategorizationJob } from '@services/ai-categorization';
import { assertImportTargetNotBankLinked } from '@services/import-export/core/assert-import-target-not-bank-linked';
import { type OpenImportBatch, withImportBatchRecord } from '@services/import-export/core/import-batch-record';
import { anchorImportDate } from '@services/import-export/core/parse/anchor-import-date';
import { createTransaction } from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { v4 as uuidv4 } from 'uuid';

interface ExecuteImportParams {
  userId: number;
  accountId: string;
  transactions: ExtractedTransaction[];
  skipIndices: number[];
  /** IANA timezone of the importing user's browser; extracted wall-clock times are read in it. */
  timezone?: string;
  /**
   * Called with the cumulative `processedCount` after every row the loop visits
   * (imported, merged, skipped or failed alike) so the worker can fan progress out
   * over SSE. `totalCount` is the full row count. Optional.
   */
  onProgress?: (processedCount: number, totalCount: number) => void | Promise<void>;
}

/**
 * Execute a statement import into an existing account. Runs OUTSIDE a wrapping
 * transaction so a single bad transaction does not nuke the whole import —
 * best-effort partial success is the contract the user sees. Each row's
 * `createTransaction` opens its own transaction, so a row that fails at the
 * database layer rolls back only itself and is reported in `summary.errors`;
 * the rows around it still commit.
 *
 * Unlike CSV import, the account must already exist (no account creation).
 * Categories are not assigned during import - they can be auto-categorized later.
 */
async function executeImportImpl({
  userId,
  accountId,
  transactions,
  skipIndices,
  timezone,
  onProgress,
  openImportBatch,
}: ExecuteImportParams & { openImportBatch: OpenImportBatch }): Promise<StatementImportSummary> {
  const batchId = uuidv4();
  const importDetails: TransactionImportDetails = {
    batchId,
    importedAt: new Date().toISOString(),
    source: ImportSource.statementParser,
  };

  // Filter out transactions that should be skipped
  const skipSet = new Set(skipIndices);
  const transactionsToImport = transactions.filter((_, index) => !skipSet.has(index));

  // Report the real total once up front so a no-op import still surfaces it
  // instead of the worker reporting 0.
  if (onProgress) await onProgress(0, transactions.length);

  if (transactionsToImport.length === 0) {
    return {
      imported: 0,
      merged: 0,
      skipped: skipIndices.length,
      errors: [],
      newTransactionIds: [],
      batchId,
    };
  }

  // Verify account exists and belongs to user. The service-layer
  // createTransaction below derives currency from the account on its own.
  const account = await Accounts.getAccountById({ userId, id: accountId });
  if (!account) {
    throw new ValidationError({
      message: `Account with ID ${accountId} not found`,
    });
  }
  assertNotDerivedBalanceAccount({ account, actionPhrase: 'be an import target' });
  assertImportTargetNotBankLinked({ account });

  // Get user's default category
  const defaultCategoryId = await Users.getUserDefaultCategory({ id: userId });

  // One probe for the whole run instead of one per row.
  const matchPlanned = await accountHasPlannedRows({ accountId });

  // A code missing from Currencies would fail the row on its foreign key, so its pair is dropped instead.
  const originalCurrencyCodes = [
    ...new Set(transactionsToImport.flatMap((tx) => (tx.originalCurrencyCode ? [tx.originalCurrencyCode] : []))),
  ];
  const knownOriginalCurrencyCodes = new Set(
    originalCurrencyCodes.length
      ? (await getCurrencies({ codes: originalCurrencyCodes })).map((currency) => currency.code)
      : [],
  );

  // Create transactions
  const errors: StatementImportError[] = [];
  const newTransactionIds: string[] = [];
  let mergedCount = 0;

  let processedCount = 0;
  const tick = async () => {
    processedCount += 1;
    if (onProgress) await onProgress(processedCount, transactions.length);
  };

  await openImportBatch({ userId, importDetails });

  for (let i = 0; i < transactions.length; i++) {
    // Skip if in skip list
    if (skipSet.has(i)) {
      await tick();
      continue;
    }

    const tx = transactions[i]!;

    try {
      // The extraction prompt only emits ISO dates, so the field order is never consulted.
      const parsedDate = parseImportDate({ value: tx.date, format: { fieldOrder: 'day-first' } });
      if (!parsedDate) {
        errors.push({ transactionIndex: i, code: 'INVALID_DATE', params: { date: tx.date } });
        continue;
      }
      const txDate = anchorImportDate({ parsed: parsedDate, timezone });

      // Validate: no future dates (with 1-day tolerance for timezone differences)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      if (txDate > tomorrow) {
        errors.push({ transactionIndex: i, code: 'FUTURE_DATE', params: { date: tx.date } });
        continue;
      }

      // Validate: amount must be positive (type determines income/expense direction)
      if (tx.amount <= 0) {
        errors.push({ transactionIndex: i, code: 'AMOUNT_NOT_POSITIVE', params: { amount: tx.amount } });
        continue;
      }

      // Validate: amount should not exceed reasonable threshold (1 billion)
      const MAX_AMOUNT = 1_000_000_000;
      if (tx.amount > MAX_AMOUNT) {
        errors.push({ transactionIndex: i, code: 'AMOUNT_TOO_LARGE', params: { amount: tx.amount, max: MAX_AMOUNT } });
        continue;
      }

      // Note: tx.amount is in decimal format from AI extraction (e.g., 35 means 35.00)
      const amount = Money.fromDecimal(tx.amount);

      const original =
        tx.originalAmount !== undefined &&
        tx.originalCurrencyCode !== undefined &&
        tx.originalCurrencyCode !== account.currencyCode &&
        knownOriginalCurrencyCodes.has(tx.originalCurrencyCode)
          ? { originalAmount: Money.fromDecimal(tx.originalAmount), originalCurrencyCode: tx.originalCurrencyCode }
          : {};

      // Service-layer createTransaction handles refAmount, payee extraction
      // (via `rawMerchantName`), and inline `payee_rule` auto-categorization.
      // Without this path the imported row would arrive at AI with
      // `categorizationMeta = null` and bypass any Payee defaults the user has
      // already set up.
      const createResult = await createTransaction({
        userId,
        amount,
        commissionRate: Money.zero(),
        note: tx.description,
        time: txDate,
        transactionType: tx.type === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        paymentType: PAYMENT_TYPES.creditCard,
        accountId,
        categoryId: defaultCategoryId,
        accountType: ACCOUNT_TYPES.system,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        externalData: {
          importDetails,
        },
        rawMerchantName: tx.merchant?.trim() || null,
        externalReference: tx.externalReference?.trim() || null,
        ...original,
        matchPlanned,
      });
      const [transaction] = createResult;

      // A merged row is an existing planned transaction the user already
      // categorized, so it stays out of the ids fed to AI categorization below.
      if (createResult.mergedIntoPlanned) {
        mergedCount += 1;
      } else if (transaction) {
        newTransactionIds.push(transaction.id);
      }
    } catch (error) {
      logger.warn('[Statement Parser] Import row failed', {
        transactionIndex: i,
        reason: error instanceof Error ? error.message : String(error),
      });
      errors.push({ transactionIndex: i, code: 'ROW_FAILED' });
    } finally {
      // `finally`, not a trailing call: the per-row validation branches above
      // `continue` out of the loop body.
      await tick();
    }
  }

  // Track analytics event
  if (newTransactionIds.length > 0) {
    trackImportCompleted({
      userId,
      importType: 'statement_parser',
      transactionsCount: newTransactionIds.length,
    });
  }

  return {
    imported: newTransactionIds.length,
    merged: mergedCount,
    skipped: skipIndices.length,
    errors,
    newTransactionIds,
    batchId,
  };
}

const executeImportWithBatchRecord = withImportBatchRecord(executeImportImpl);

/**
 * Execute statement import and queue AI categorization for imported transactions.
 * The categorization is queued AFTER the per-row transactions have committed.
 */
export async function executeImport(params: ExecuteImportParams): Promise<StatementImportSummary> {
  const result = await executeImportWithBatchRecord(params);

  // Queue AI categorization for the newly imported transactions. Each row was
  // committed by its own createTransaction call above, so the queued ids point
  // at rows that are durably persisted.
  if (result.newTransactionIds.length > 0) {
    await queueCategorizationJob({
      userId: params.userId,
      transactionIds: result.newTransactionIds,
      scope: CATEGORIZATION_SCOPE.anyCategory,
      trigger: CATEGORIZATION_TRIGGER.import,
    });
  }

  return result;
}
