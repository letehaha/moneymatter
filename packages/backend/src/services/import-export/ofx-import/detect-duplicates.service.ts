import type { DuplicateMatch, ParsedTransactionRow } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import * as Transactions from '@models/transactions.model';
import { getAccountDecimals } from '@services/import-export/core/duplicates/get-account-decimals';
import { importDayKey } from '@services/import-export/core/duplicates/import-day-key';
import { duplicateAmountKey } from '@services/transactions/duplicates-detection/amount-key';

import { readOfxUpload } from './upload-cache';

export async function detectOfxDuplicates({
  userId,
  uploadId,
  accountMapping,
}: {
  userId: number;
  uploadId: string;
  accountMapping: import('@bt/shared/types').OfxAccountMapping;
}): Promise<{ duplicates: DuplicateMatch[] }> {
  const parsed = await readOfxUpload({ userId, uploadId });
  const accountNameToId = new Map<string, string | null>();

  for (const account of parsed.accounts) {
    const mapping = accountMapping[account.sourceAccountKey];
    if (mapping?.action === 'link-existing') {
      accountNameToId.set(account.sourceAccountKey, mapping.accountId);
    }
  }

  if (accountNameToId.size === 0) return { duplicates: [] };

  const currencyByAccountKey = new Map(parsed.accounts.map((account) => [account.sourceAccountKey, account.currency]));
  const validRows: ParsedTransactionRow[] = parsed.transactions
    .filter((tx) => accountNameToId.has(tx.sourceAccountKey))
    .map((tx) => ({
      rowIndex: tx.rowIndex,
      originalId: tx.sourceTransactionKey,
      date: tx.date,
      amount: Money.fromDecimal(tx.amount).abs().toNumber(),
      description: tx.note,
      accountName: tx.sourceAccountKey,
      currencyCode: currencyByAccountKey.get(tx.sourceAccountKey)!,
      transactionType: tx.type === TRANSACTION_TYPES.expense ? 'expense' : 'income',
    }));

  const duplicates = await findOfxDuplicates({ userId, validRows, accountNameToId });
  return { duplicates };
}

async function findOfxDuplicates({
  userId,
  validRows,
  accountNameToId,
}: {
  userId: number;
  validRows: ParsedTransactionRow[];
  accountNameToId: Map<string, string | null>;
}): Promise<DuplicateMatch[]> {
  const duplicates: DuplicateMatch[] = [];
  const rowsByOriginalId = new Map<string, ParsedTransactionRow>();
  const fallbackRows: ParsedTransactionRow[] = [];

  for (const row of validRows) {
    const accountId = accountNameToId.get(row.accountName);
    if (!accountId) continue;
    // A FITID is authoritative. If it does not match, do not let the less
    // precise fallback rules classify the row as a duplicate.
    if (row.originalId) rowsByOriginalId.set(`${accountId}:${row.originalId}`, row);
    else fallbackRows.push(row);
  }

  if (rowsByOriginalId.size > 0) {
    const originalIds = [...new Set([...rowsByOriginalId.values()].map((row) => row.originalId!))];
    const matches = await Transactions.getTransactionsByArrayOfField({
      fieldValues: originalIds,
      fieldName: 'originalId',
      userId,
    });

    for (const transaction of matches) {
      if (!transaction.originalId) continue;
      const row = rowsByOriginalId.get(`${transaction.accountId}:${transaction.originalId}`);
      if (row) duplicates.push(toDuplicateMatch({ row, transaction, matchType: 'originalId' }));
    }
  }

  if (fallbackRows.length === 0) return duplicates;

  const dates = fallbackRows.map(({ date }) => date);
  const minDay = importDayKey({ iso: dates.reduce((left, right) => (left < right ? left : right)) });
  const maxDay = importDayKey({ iso: dates.reduce((left, right) => (left > right ? left : right)) });
  const accountIds = [...new Set(fallbackRows.map((row) => accountNameToId.get(row.accountName)!))];
  const decimalsByAccountId = await getAccountDecimals({ accountIds });
  const existing = await Transactions.findWithFilters({
    access: { creator: userId },
    accountIds,
    startDate: `${minDay}T00:00:00.000Z`,
    endDate: `${maxDay}T23:59:59.999Z`,
    completeness: { cap: { limit: 10000, onTruncated: 'log' } },
    planned: 'exclude',
    balanceAdjustments: 'include',
  });

  // Keep only the first transaction for each exact fallback identity. This
  // makes lookup O(1) per imported row and avoids fuzzy description work.
  const firstByFallbackKey = new Map<string, Transactions.default>();
  for (const transaction of existing) {
    const decimals = decimalsByAccountId.get(transaction.accountId);
    if (decimals === undefined) continue;

    const key = fallbackKey({
      accountId: transaction.accountId,
      date: new Date(transaction.time).toISOString(),
      amount: transaction.amount,
      decimals,
      transactionType: transaction.transactionType,
    });
    if (!firstByFallbackKey.has(key)) firstByFallbackKey.set(key, transaction);
  }

  for (const row of fallbackRows) {
    const accountId = accountNameToId.get(row.accountName)!;
    const decimals = decimalsByAccountId.get(accountId);
    if (decimals === undefined) continue;

    const transactionType = row.transactionType === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;
    const transaction = firstByFallbackKey.get(
      fallbackKey({ accountId, date: row.date, amount: row.amount, decimals, transactionType }),
    );
    if (transaction) duplicates.push(toDuplicateMatch({ row, transaction, matchType: 'exact' }));
  }

  return duplicates;
}

/** The amount is keyed at the account currency's `decimals`, rounded half-up, so both sides compare one value. */
function fallbackKey({
  accountId,
  date,
  amount,
  decimals,
  transactionType,
}: {
  accountId: string;
  date: string;
  amount: Money | number;
  decimals: number;
  transactionType: TRANSACTION_TYPES;
}): string {
  return `${accountId}:${importDayKey({ iso: date })}:${duplicateAmountKey({ amount, decimals })}:${transactionType}`;
}

function toDuplicateMatch({
  row,
  transaction,
  matchType,
}: {
  row: ParsedTransactionRow;
  transaction: Transactions.default;
  matchType: DuplicateMatch['matchType'];
}): DuplicateMatch {
  return {
    rowIndex: row.rowIndex,
    importedTransaction: row,
    existingTransaction: {
      id: transaction.id,
      date: importDayKey({ iso: new Date(transaction.time).toISOString() }),
      amount: transaction.amount.toNumber(),
      note: transaction.note || '',
      accountId: transaction.accountId,
    },
    matchType,
    confidence: 100,
  };
}
