import { SORT_DIRECTIONS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import Transactions from '@models/transactions.model';
import { getDismissalsForUser } from '@models/transfer-suggestion-dismissals.model';
import { getTransactions } from '@services/transactions/get-transactions';
import {
  type TransferPairReview,
  aiReviewTransferMatches,
  transferPairKey,
} from '@services/transactions/transactions-linking/ai-review-transfer-matches';
import { addDays, endOfDay, startOfDay, subDays } from 'date-fns';

import { MS_PER_DAY, RECOMMENDATION_DAYS_RANGE, RECOMMENDATION_PERCENT_RANGE } from './constants';

const MAX_MATCHES_PER_EXPENSE = 4;
/** Below this the pair is a coincidence of amount and date, not worth showing. */
const MIN_CONFIDENCE = 50;
const CONFIDENCE_WEIGHT_AMOUNT = 50;
const CONFIDENCE_WEIGHT_DATE = 30;
const CONFIDENCE_WEIGHT_CURRENCY = 20;

interface BulkScanMatch {
  transaction: Transactions;
  confidence: number;
  ai?: TransferPairReview;
}

interface BulkScanItem {
  expense: Transactions;
  matches: BulkScanMatch[];
}

interface BulkScanResult {
  total: number;
  items: BulkScanItem[];
}

const verdictRank = (match: { ai?: TransferPairReview }) => (match.ai?.verdict === 'likely' ? 0 : 1);

const emptyResult = (): BulkScanResult => ({ total: 0, items: [] });

function isEligibleCandidate({
  tx,
  allowedTransferNatures,
}: {
  tx: Transactions;
  allowedTransferNatures: TRANSACTION_TRANSFER_NATURE[];
}): boolean {
  return (
    (!tx.splits || tx.splits.length === 0) &&
    allowedTransferNatures.includes(tx.transferNature as TRANSACTION_TRANSFER_NATURE)
  );
}

function calculateConfidence({
  expenseRefAmountCents,
  matchRefAmountCents,
  expenseTime,
  matchTime,
  expenseCurrency,
  matchCurrency,
}: {
  expenseRefAmountCents: number;
  matchRefAmountCents: number;
  expenseTime: Date;
  matchTime: Date;
  expenseCurrency: string;
  matchCurrency: string;
}): number {
  // Amount proximity: 50% weight
  const maxAmountDiff = expenseRefAmountCents * RECOMMENDATION_PERCENT_RANGE;
  const actualAmountDiff = Math.abs(matchRefAmountCents - expenseRefAmountCents);
  const amountScore =
    maxAmountDiff > 0 ? CONFIDENCE_WEIGHT_AMOUNT * (1 - actualAmountDiff / maxAmountDiff) : CONFIDENCE_WEIGHT_AMOUNT;

  // Date proximity: 30% weight
  const maxDaysDiff = RECOMMENDATION_DAYS_RANGE;
  const actualDaysDiff = Math.abs(expenseTime.getTime() - matchTime.getTime()) / MS_PER_DAY;
  const dateScore = CONFIDENCE_WEIGHT_DATE * (1 - Math.min(actualDaysDiff, maxDaysDiff) / maxDaysDiff);

  // Currency match: 20% weight
  const currencyScore = expenseCurrency === matchCurrency ? CONFIDENCE_WEIGHT_CURRENCY : 0;

  return Math.round(amountScore + dateScore + currencyScore);
}

/**
 * Scans the expenses of a date range for incomes on other accounts that could be the other leg
 * of a transfer (±10% in base currency, ±14 days), scores each pair and leaves out the pairs the
 * user dismissed. Reads only: nothing is linked or stored.
 */
export async function bulkScanTransferRecommendations({
  userId,
  from,
  to,
  limit,
  offset,
  includeOutOfWallet,
  aiReview,
}: {
  userId: number;
  from: string;
  to: string;
  limit: number;
  offset: number;
  includeOutOfWallet: boolean;
  aiReview: boolean;
}): Promise<BulkScanResult> {
  const dateFromParsed = startOfDay(new Date(from));
  const dateToParsed = endOfDay(new Date(to));

  // Transfer natures to include in the scan
  const allowedTransferNatures = [TRANSACTION_TRANSFER_NATURE.not_transfer];
  if (includeOutOfWallet) {
    allowedTransferNatures.push(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
  }

  // 1. Fetch all expense transactions in the date range that are NOT linked transfers/refunds
  // When includeOutOfWallet, we can't use excludeTransfer (it excludes everything except not_transfer),
  // so we skip the filter and post-filter by allowed natures instead.
  const expenses = (await getTransactions({
    userId,
    from: 0,
    limit: Infinity, // fetch all in range — Infinity bypasses the default limit of 20
    transactionType: TRANSACTION_TYPES.expense,
    excludeTransfer: !includeOutOfWallet,
    excludeRefunds: true,
    isPlanned: false,
    includeSplits: true,
    startDate: dateFromParsed.toISOString(),
    endDate: dateToParsed.toISOString(),
    order: SORT_DIRECTIONS.desc,
  })) as Transactions[];

  if (expenses.length === 0) {
    return emptyResult();
  }

  // Filter out parent transactions with splits and non-allowed transfer natures
  const eligibleExpenses = expenses.filter((tx) => isEligibleCandidate({ tx, allowedTransferNatures }));

  if (eligibleExpenses.length === 0) {
    return emptyResult();
  }

  // 2. Fetch all income candidates in expanded date range
  // Expand by ±14 days to catch matches for expenses near the boundaries
  const incomeStartDate = subDays(dateFromParsed, RECOMMENDATION_DAYS_RANGE);
  const incomeEndDate = addDays(dateToParsed, RECOMMENDATION_DAYS_RANGE);

  const incomes = (await getTransactions({
    userId,
    from: 0,
    limit: Infinity,
    transactionType: TRANSACTION_TYPES.income,
    excludeTransfer: !includeOutOfWallet,
    excludeRefunds: true,
    isPlanned: false,
    includeSplits: true,
    startDate: incomeStartDate.toISOString(),
    endDate: incomeEndDate.toISOString(),
    order: SORT_DIRECTIONS.desc,
  })) as Transactions[];

  // Filter out parent transactions with splits and non-allowed transfer natures
  const eligibleIncomes = incomes.filter((tx) => isEligibleCandidate({ tx, allowedTransferNatures }));

  // 3. Load dismissed pairs to filter them out (scoped to relevant expenses)
  const eligibleExpenseIds = eligibleExpenses.map((e) => e.id);
  const dismissals = await getDismissalsForUser({ userId, expenseTransactionIds: eligibleExpenseIds });
  const dismissedPairsSet = new Set(dismissals.map((d) => `${d.expenseTransactionId}:${d.incomeTransactionId}`));

  // 4. Match expenses to incomes in-memory
  let results: BulkScanItem[] = [];

  for (const expense of eligibleExpenses) {
    // Matching compares base-currency amounts, so a row still waiting for a custom-currency rate has none to compare.
    if (!expense.refAmount) continue;

    const expenseRefCents = expense.refAmount.toCents();
    const lowerBound = Math.max(0, Math.floor(expenseRefCents * (1 - RECOMMENDATION_PERCENT_RANGE)));
    const upperBound = Math.ceil(expenseRefCents * (1 + RECOMMENDATION_PERCENT_RANGE));
    const expenseTime = new Date(expense.time);

    const matchCandidates: BulkScanMatch[] = [];

    for (const income of eligibleIncomes) {
      // Skip dismissed pairs
      if (dismissedPairsSet.has(`${expense.id}:${income.id}`)) continue;

      // Different account
      if (income.accountId === expense.accountId) continue;

      if (!income.refAmount) continue;

      // Amount within ±10%
      const incomeRefCents = income.refAmount.toCents();
      if (incomeRefCents < lowerBound || incomeRefCents > upperBound) continue;

      // Date within ±14 days
      const incomeTime = new Date(income.time);
      const daysDiff = Math.abs(expenseTime.getTime() - incomeTime.getTime()) / MS_PER_DAY;
      if (daysDiff > RECOMMENDATION_DAYS_RANGE) continue;

      const confidence = calculateConfidence({
        expenseRefAmountCents: expenseRefCents,
        matchRefAmountCents: incomeRefCents,
        expenseTime,
        matchTime: incomeTime,
        expenseCurrency: expense.currencyCode,
        matchCurrency: income.currencyCode,
      });

      if (confidence < MIN_CONFIDENCE) continue;

      matchCandidates.push({ transaction: income, confidence });
    }

    if (matchCandidates.length > 0) {
      // Sort by confidence descending
      matchCandidates.sort((a, b) => b.confidence - a.confidence);
      results.push({
        expense,
        matches: matchCandidates.slice(0, MAX_MATCHES_PER_EXPENSE),
      });
    }
  }

  // 5. Sort results by expense date descending (newest first)
  results.sort((a, b) => new Date(b.expense.time).getTime() - new Date(a.expense.time).getTime());

  if (aiReview) {
    const reviews = await aiReviewTransferMatches({
      userId,
      pairs: results.flatMap(({ expense, matches }) =>
        matches.map(({ transaction }) => ({ expenseId: expense.id, incomeId: transaction.id })),
      ),
    });
    results = results
      .map(({ expense, matches }) => ({
        expense,
        matches: matches
          .map((match) => ({
            ...match,
            ai: reviews.get(transferPairKey({ expenseId: expense.id, incomeId: match.transaction.id })),
          }))
          .filter((match) => match.ai?.verdict !== 'unlikely')
          .toSorted((a, b) => verdictRank(a) - verdictRank(b) || b.confidence - a.confidence),
      }))
      .filter(({ matches }) => matches.length > 0);
  }

  // 6. Apply pagination. A reviewed scan answers in one page, so paging never re-runs the AI.
  return { total: results.length, items: aiReview ? results : results.slice(offset, offset + limit) };
}
