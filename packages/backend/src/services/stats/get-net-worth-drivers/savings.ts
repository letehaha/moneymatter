import { type MinorUnits, TRANSACTION_TYPES, asMinorUnits } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import type { CategoryRefundPair } from '@services/stats/category-allocation';
import { type PeriodBucket, findBucketIndex } from '@services/stats/utils';

export interface SavingsTransactionRow {
  time: string | Date;
  /** `null` while a custom currency has no rate: the row is left out of the totals. */
  refAmount: Money | null;
  transactionType: TRANSACTION_TYPES;
}

interface SavingsMinor {
  income: MinorUnits;
  expenses: MinorUnits;
  net: MinorUnits;
}

/**
 * Per-bucket income/expense totals in base-currency minor units, matching
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
  decimals,
}: {
  transactions: SavingsTransactionRow[];
  buckets: PeriodBucket[];
  refundPairs?: CategoryRefundPair[];
  /** Decimals of the base currency: the scale `refAmount` is converted to minor units at. */
  decimals: number;
}): SavingsMinor[] => {
  const savings: SavingsMinor[] = buckets.map(() => ({
    income: asMinorUnits(0),
    expenses: asMinorUnits(0),
    net: asMinorUnits(0),
  }));

  for (const tx of transactions) {
    if (tx.refAmount === null) continue;

    const bucketIndex = findBucketIndex({ transactionTime: new Date(tx.time), buckets });
    if (bucketIndex === -1) continue;

    const bucket = savings[bucketIndex]!;
    const amount = tx.refAmount.toMinorUnits({ decimals });

    if (tx.transactionType === TRANSACTION_TYPES.income) {
      bucket.income = asMinorUnits(bucket.income + amount);
    } else if (tx.transactionType === TRANSACTION_TYPES.expense) {
      bucket.expenses = asMinorUnits(bucket.expenses + amount);
    }
  }

  for (const pair of refundPairs) {
    // Netting needs both halves inside the report's scope: subtracting a half whose
    // counterpart never contributed would take away money the report never counted.
    if (!pair.expenseInScope || !pair.incomeInScope) continue;

    const bucketIndex = findBucketIndex({ transactionTime: new Date(pair.time), buckets });
    if (bucketIndex === -1) continue;

    const bucket = savings[bucketIndex]!;
    bucket.income = asMinorUnits(bucket.income - pair.minor);
    bucket.expenses = asMinorUnits(bucket.expenses - pair.minor);
  }

  for (const bucket of savings) {
    bucket.net = asMinorUnits(bucket.income - bucket.expenses);
  }

  return savings;
};
