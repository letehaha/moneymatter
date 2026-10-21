import type {
  BudgetBakersWalletAccountMapping,
  BudgetBakersWalletParseAccount,
  DuplicateMatch,
  ParsedTransactionRow,
} from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { findDuplicates } from '@services/import-export/core/duplicates/find-duplicates';

import { parseBudgetBakersWalletCsv } from './parse-budget-bakers-wallet.service';

interface DetectBudgetBakersWalletDuplicatesParams {
  userId: number;
  fileContent: string;
  accountMapping: BudgetBakersWalletAccountMapping;
}

/**
 * Duplicate detection for a Wallet import, reusing the generic CSV importer's
 * `findDuplicates` (3-tier exact/fuzzy matching by account + day + amount).
 *
 * Only `link-existing` accounts can have duplicates — a freshly created account
 * has no prior transactions to match against. Detection covers ordinary rows and
 * unpaired out-of-wallet legs; paired transfers are excluded because a transfer
 * spans two accounts and two legs with no single account/day/amount signature for
 * `findDuplicates` to match, so it cannot be reliably identified as a duplicate.
 * When no account links to an existing one, returns immediately without touching
 * the DB.
 */
export async function detectBudgetBakersWalletDuplicates({
  userId,
  fileContent,
  accountMapping,
}: DetectBudgetBakersWalletDuplicatesParams): Promise<{ duplicates: DuplicateMatch[] }> {
  const parsed = parseBudgetBakersWalletCsv({ fileContent });

  // Map each link-existing account's original name to its existing account id.
  // `findDuplicates` treats any name not in this map (or mapped to null) as a
  // new account and skips it — so create-new accounts simply never appear here.
  const accountNameToId = new Map<string, string | null>();
  for (const account of parsed.accounts) {
    const mapping = accountMapping[account.originalName];
    if (mapping?.action === 'link-existing') {
      accountNameToId.set(account.originalName, mapping.accountId);
    }
  }

  if (accountNameToId.size === 0) {
    return { duplicates: [] };
  }

  // Index accounts by their original name once, so the per-transaction currency
  // lookup below is O(1) instead of a linear scan per row.
  const accountByName = new Map<string, BudgetBakersWalletParseAccount>();
  for (const account of parsed.accounts) {
    accountByName.set(account.originalName, account);
  }

  // Build the dedup rows only for transactions on linked accounts. Transfers
  // never enter this set — they have no single account/day/amount signature to
  // match on, so they cannot be reliably detected as duplicates. `description`
  // carries the note so the fuzzy tier can compare against existing transaction
  // notes.
  const validRows: ParsedTransactionRow[] = [];
  for (const tx of parsed.transactions) {
    if (!accountNameToId.has(tx.accountName)) continue;
    const account = accountByName.get(tx.accountName)!;
    validRows.push({
      rowIndex: tx.rowIndex,
      date: tx.date,
      amount: Math.abs(tx.amount),
      description: tx.note,
      accountName: tx.accountName,
      currencyCode: account.currency,
      // Direction from the parsed CSV `type`, not the sign of `amount` (a
      // zero-amount row loses its sign but keeps its real Expense/Income type).
      transactionType: tx.type === TRANSACTION_TYPES.expense ? 'expense' : 'income',
    });
  }

  const duplicates = await findDuplicates({ userId, validRows, accountNameToId });
  return { duplicates };
}
