import { type Cents, TRANSACTION_TYPES, asCents } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import type { CategoryRefundPair } from '@services/stats/category-allocation';
import { type PeriodBucket, findBucketIndex } from '@services/stats/utils';

export interface SavingsTransactionRow {
  time: string | Date;
  refAmount: Money;
  transactionType: TRANSACTION_TYPES;
}

interface SavingsCents {
  income: Cents;
  expenses: Cents;
  net: Cents;
}

/**
 * Per-bucket income/expense totals in base-currency cents, matching
 * `get-cash-flow`'s semantics exactly: expenses accumulate as a positive number
 * and `net` is `income - expenses`.
 *
 * Transfers never reach here — the caller filters them out at the query level,
 * which is what makes savings "money that actually entered or left the user's
 * finances" rather than money shuffled between their own accounts.
 *
 * Refunded money was neither spent nor earned, so each pair is subtracted from both
 * sides in the bucket the money came back in — the same netting `get-cash-flow` does,
 * which leaves `net` untouched.
 */
export const accumulateSavings = ({
  transactions,
  buckets,
  refundPairs = [],
}: {
  transactions: SavingsTransactionRow[];
  buckets: PeriodBucket[];
  refundPairs?: CategoryRefundPair[];
}): SavingsCents[] => {
  const savings: SavingsCents[] = buckets.map(() => ({ income: asCents(0), expenses: asCents(0), net: asCents(0) }));

  for (const tx of transactions) {
    const bucketIndex = findBucketIndex({ transactionTime: new Date(tx.time), buckets });
    if (bucketIndex === -1) continue;

    const bucket = savings[bucketIndex]!;
    const amount = tx.refAmount.toCents();

    if (tx.transactionType === TRANSACTION_TYPES.income) {
      bucket.income = asCents(bucket.income + amount);
    } else if (tx.transactionType === TRANSACTION_TYPES.expense) {
      bucket.expenses = asCents(bucket.expenses + amount);
    }
  }

  for (const pair of refundPairs) {
    // Netting needs both halves inside the report's scope: subtracting a half whose
    // counterpart never contributed would take away money the report never counted.
    if (!pair.expenseInScope || !pair.incomeInScope) continue;

    const bucketIndex = findBucketIndex({ transactionTime: new Date(pair.time), buckets });
    if (bucketIndex === -1) continue;

    const bucket = savings[bucketIndex]!;
    bucket.income = asCents(bucket.income - pair.minor);
    bucket.expenses = asCents(bucket.expenses - pair.minor);
  }

  for (const bucket of savings) {
    bucket.net = asCents(bucket.income - bucket.expenses);
  }

  return savings;
};
