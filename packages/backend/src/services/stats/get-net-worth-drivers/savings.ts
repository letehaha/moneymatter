import { type Cents, TRANSACTION_TYPES, asCents } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import { type CategoryRefundPair, refundLegs } from '@services/stats/category-allocation';
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
 * Refunded money was neither spent nor earned, so each in-scope side of a pair is
 * subtracted in its own transaction's bucket — the same netting `get-cash-flow` does.
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

  for (const side of [TRANSACTION_TYPES.expense, TRANSACTION_TYPES.income]) {
    for (const leg of refundLegs({ pairs: refundPairs, side })) {
      const bucketIndex = findBucketIndex({ transactionTime: leg.time, buckets });
      if (bucketIndex === -1) continue;

      const bucket = savings[bucketIndex]!;
      if (side === TRANSACTION_TYPES.income) {
        bucket.income = asCents(bucket.income + leg.cents);
      } else {
        bucket.expenses = asCents(bucket.expenses + leg.cents);
      }
    }
  }

  for (const bucket of savings) {
    bucket.net = asCents(bucket.income - bucket.expenses);
  }

  return savings;
};
