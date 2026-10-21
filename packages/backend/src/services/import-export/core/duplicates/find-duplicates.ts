import type { DuplicateMatch, ParsedTransactionRow } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import * as Transactions from '@models/transactions.model';
import { duplicateAmountKey } from '@services/transactions/duplicates-detection/amount-key';

import { getAccountDecimals } from './get-account-decimals';
import { importDayKey } from './import-day-key';

interface FindDuplicatesParams {
  userId: number;
  validRows: ParsedTransactionRow[];
  accountNameToId: Map<string, string | null>;
}

/**
 * Find duplicate transactions using 3-tier algorithm:
 * 1. originalId match (if present)
 * 2. Exact match (accountId + date + amount)
 * 3. Fuzzy match (accountId + date + amount + similar description)
 *
 * Amounts are keyed as decimals rounded to the account currency's decimals, so a row that
 * carries more digits than the account stores meets the stored amount it would be written as.
 */
export async function findDuplicates({
  userId,
  validRows,
  accountNameToId,
}: FindDuplicatesParams): Promise<DuplicateMatch[]> {
  const duplicates: DuplicateMatch[] = [];

  if (validRows.length === 0) {
    return duplicates;
  }

  // Get all account IDs that are already in the system (not null = not new)
  const existingAccountIds = new Set(Array.from(accountNameToId.values()).filter((id): id is string => id !== null));

  if (existingAccountIds.size === 0) {
    // All accounts are new, no duplicates possible
    return duplicates;
  }

  // Duplicate matching is day-granular (the keys below compare calendar days),
  // so the fetch window must cover whole UTC days. `row.date` is an anchored
  // instant at an arbitrary time-of-day (e.g. local noon); flooring the min to
  // start-of-day and ceiling the max to end-of-day keeps an existing same-day
  // transaction in range no matter what hour either side falls on.
  const dates = validRows.map((r) => r.date);
  const minDay = importDayKey({ iso: dates.reduce((a, b) => (a < b ? a : b)) });
  const maxDay = importDayKey({ iso: dates.reduce((a, b) => (a > b ? a : b)) });

  const decimalsByAccountId = await getAccountDecimals({ accountIds: Array.from(existingAccountIds) });

  // Fetch existing transactions in the date range for these accounts
  const existingTransactions = await Transactions.findWithFilters({
    access: { creator: userId },
    accountIds: Array.from(existingAccountIds),
    startDate: `${minDay}T00:00:00.000Z`,
    endDate: `${maxDay}T23:59:59.999Z`,
    completeness: { cap: { limit: 10000, onTruncated: 'log' } },
    // Planned rows are merge targets for incoming rows, not duplicates of them.
    planned: 'exclude',
    balanceAdjustments: 'include',
  });

  // Build lookup maps for efficient matching
  const exactMatchMap = new Map<string, Transactions.default[]>();
  for (const tx of existingTransactions) {
    const decimals = decimalsByAccountId.get(tx.accountId);
    if (decimals === undefined) continue;

    const dateStr = importDayKey({ iso: new Date(tx.time).toISOString() });
    const key = `${tx.accountId}:${dateStr}:${duplicateAmountKey({ amount: tx.amount, decimals })}`;

    if (!exactMatchMap.has(key)) {
      exactMatchMap.set(key, []);
    }
    exactMatchMap.get(key)!.push(tx);
  }

  // Check each valid row for duplicates
  for (const row of validRows) {
    const accountId = accountNameToId.get(row.accountName);
    if (accountId === null || accountId === undefined) {
      // Account doesn't exist yet, can't be a duplicate
      continue;
    }

    // `row.date` is a full ISO instant, but existing transactions are keyed by
    // calendar day above — normalise the row to the same day granularity so a
    // same-day match still lands in the same bucket.
    const decimals = decimalsByAccountId.get(accountId);
    if (decimals === undefined) {
      // Not one of the user's accounts, so nothing of theirs can match
      continue;
    }

    const rowDateStr = importDayKey({ iso: new Date(row.date).toISOString() });
    const key = `${accountId}:${rowDateStr}:${duplicateAmountKey({ amount: row.amount, decimals })}`;
    const candidates = exactMatchMap.get(key) || [];

    if (candidates.length === 0) {
      continue;
    }

    // Check transaction type matches
    const expectedType = row.transactionType === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;

    const typeMatchedCandidates = candidates.filter((tx) => tx.transactionType === expectedType);

    if (typeMatchedCandidates.length === 0) {
      continue;
    }

    // Check for exact match first
    let bestMatch: Transactions.default | null = null;
    let matchType: 'exact' | 'fuzzy' = 'exact';
    let confidence = 100;

    // If there's only one candidate with matching type, it's likely a duplicate
    if (typeMatchedCandidates.length === 1) {
      bestMatch = typeMatchedCandidates[0]!;
      // Lower confidence if descriptions are very different
      if (row.description && bestMatch.note) {
        const similarity = calculateSimilarity(row.description, bestMatch.note);
        if (similarity < 50) {
          matchType = 'fuzzy';
          confidence = 70 + Math.floor(similarity * 0.3);
        }
      }
    } else {
      // Multiple candidates - try to find best match by description
      let bestSimilarity = 0;
      for (const candidate of typeMatchedCandidates) {
        if (row.description && candidate.note) {
          const similarity = calculateSimilarity(row.description, candidate.note);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = candidate;
          }
        } else if (!bestMatch) {
          bestMatch = candidate;
        }
      }

      if (bestMatch) {
        if (bestSimilarity >= 80) {
          matchType = 'exact';
          confidence = 95;
        } else if (bestSimilarity >= 50) {
          matchType = 'fuzzy';
          confidence = 70 + Math.floor(bestSimilarity * 0.3);
        } else {
          matchType = 'fuzzy';
          confidence = 60;
        }
      }
    }

    if (bestMatch) {
      duplicates.push({
        rowIndex: row.rowIndex,
        importedTransaction: row,
        existingTransaction: {
          id: bestMatch.id,
          date: importDayKey({ iso: new Date(bestMatch.time).toISOString() }),
          amount: bestMatch.amount.toNumber(),
          note: bestMatch.note || '',
          accountId: bestMatch.accountId,
        },
        matchType,
        confidence,
      });
    }
  }

  return duplicates;
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a value between 0 (no match) and 100 (exact match)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;

  const maxLen = Math.max(s1.length, s2.length);
  const distance = levenshteinDistance(s1, s2);

  return Math.round(((maxLen - distance) / maxLen) * 100);
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;

  // Create matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}
