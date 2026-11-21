import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits, {
  CreateSplitPayload,
  bulkCreateSplits,
  deleteSplitsForTransaction,
} from '@models/transaction-splits.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';

import { SplitInput } from './types';
import { assertValidSplits } from './validate-splits';

interface ManageSplitsParams {
  transactionId: string;
  /** Caller's userId. Stamped on newly inserted split rows as creator metadata; also
   *  used to fetch the caller's base currency for refAmount conversion. */
  userId: number;
  /** Owner of the transaction's account: owns the categories the split rows reference, and its
   *  definition of the currency rounds the split amounts. */
  accountOwnerUserId: number;
  splits: SplitInput[];
  transactionAmount: Money;
  transactionCurrencyCode: string;
  transactionTime: Date;
  transferNature?: string;
}

const sumSplits = ({ splits }: { splits: SplitInput[] }): Money =>
  Money.sum(splits.map((split) => split.amount ?? Money.zero()));

/** Takes whatever the splits exceed `total` by off the largest splits first. */
const trimSplitsToTotal = ({ splits, total }: { splits: SplitInput[]; total: Money }): SplitInput[] => {
  let excess = sumSplits({ splits }).subtract(total);
  if (!excess.isPositive()) return splits;

  const trimmed = [...splits];
  const amountOf = ({ index }: { index: number }) => (splits[index]!.amount ?? Money.zero()).toBig();
  const largestFirst = splits
    .map((_, index) => index)
    .toSorted((a, b) => amountOf({ index: b }).cmp(amountOf({ index: a })));

  for (const index of largestFirst) {
    const amount = trimmed[index]!.amount;
    if (!excess.isPositive() || !amount?.isPositive()) break;

    const cut = amount.lessThan(excess) ? amount : excess;
    trimmed[index] = { ...trimmed[index]!, amount: amount.subtract(cut) };
    excess = excess.subtract(cut);
  }

  return trimmed;
};

/**
 * Creates or updates splits for a transaction.
 * Validates splits, deletes existing ones, and creates new ones.
 * Also handles refund link migration when splits are recreated. Refund caps are not checked
 * here: callers run `validateRefundLinks` afterwards, in the same DB transaction.
 *
 * Auth is gated by the parent transaction's account (callers run this only after
 * confirming write access). Lookups inside this helper key off `transactionId`
 * (and `splitId` for refund links) — never the caller's `userId` — so a recipient
 * with `transactionsWriteScope: 'all'` can edit splits on a transaction whose
 * row-level `userId` is the account owner. The `userId` param is still threaded
 * through as the *creator* metadata stamped on newly inserted split rows.
 */
export const manageSplits = async ({
  transactionId,
  userId,
  accountOwnerUserId,
  splits: requestedSplits,
  transactionAmount: requestedTransactionAmount,
  transactionCurrencyCode,
  transactionTime,
  transferNature,
}: ManageSplitsParams): Promise<TransactionSplits[]> => {
  const transactionDecimals = await getCurrencyDecimals({
    userId: accountOwnerUserId,
    code: transactionCurrencyCode,
  });
  const transactionAmount = requestedTransactionAmount.round(transactionDecimals);
  const roundedSplits = requestedSplits?.map((split) => ({
    ...split,
    amount: split.amount?.round(transactionDecimals) ?? split.amount,
  }));
  // Rounding is monotonic, so any split sum that fits the entered amount also fits once both are
  // rounded, even when callers pass the amount already rounded. Rounding each split can still push
  // their sum over, so the excess comes off the splits before the validator checks the rounded sum.
  const splits =
    requestedSplits && sumSplits({ splits: requestedSplits }).round(transactionDecimals).lte(transactionAmount)
      ? trimSplitsToTotal({ splits: roundedSplits!, total: transactionAmount })
      : roundedSplits;

  // Fetch existing splits — keyed by transactionId; userId is creator metadata only.
  const existingSplits = await TransactionSplits.findAll({
    where: { transactionId },
  });

  // categoryId -> RefundTransactions row ids. The old splits get deleted further down, and
  // the FK is ON DELETE SET NULL, so `splitId` stops identifying these rows.
  const refundsByCategoryId = new Map<string, { refundIds: string[] }>();

  // Query refunds for each split that exists
  for (const existingSplit of existingSplits) {
    const refunds = await RefundTransactions.findAll({
      where: { splitId: existingSplit.id },
      attributes: ['id'],
    });

    if (refunds.length > 0) {
      refundsByCategoryId.set(existingSplit.categoryId, { refundIds: refunds.map((r) => r.id) });
    }
  }

  // If no splits provided, relink any split-level refunds to main transaction
  if (!splits || splits.length === 0) {
    // Move refunds from split-level to transaction-level (set splitId to null)
    for (const { refundIds } of refundsByCategoryId.values()) {
      await RefundTransactions.update({ splitId: null }, { where: { id: refundIds } });
    }
    await deleteSplitsForTransaction({ transactionId });
    return [];
  }

  // Validate splits — category ownership lookup uses the account owner's userId so
  // recipient writes on shared accounts validate against the owner's category set.
  await assertValidSplits({
    splits,
    transactionAmount,
    minSplitAmount: Money.fromMinorUnits({ value: 1, decimals: transactionDecimals }),
    categoryOwnerUserId: accountOwnerUserId,
    transferNature: transferNature as Parameters<typeof assertValidSplits>[0]['transferNature'],
  });

  // Get user's base currency for refAmount calculation
  const { currency: baseCurrency } = await UsersCurrencies.getCurrency({
    userId,
    isDefaultCurrency: true,
  });

  const isBaseCurrency = transactionCurrencyCode === baseCurrency.code;

  // The split ref amounts convert with the caller's rates, which a collaborator needs connected first.
  if (accountOwnerUserId !== userId && !isBaseCurrency) {
    await ensureUserCurrencyConnected({
      userId,
      currencyCode: transactionCurrencyCode,
      definitionOwnerUserId: accountOwnerUserId,
    });
  }
  const baseDecimals = await getCurrencyDecimals({ userId, code: baseCurrency.code });

  // Prepare split payloads with calculated refAmounts
  const splitPayloads: CreateSplitPayload[] = await Promise.all(
    splits.map(async (split) => {
      let refAmount = split.amount;

      // Calculate refAmount if transaction is in a different currency
      if (!isBaseCurrency) {
        if (split.refAmount !== undefined) {
          // Use provided refAmount if available
          refAmount = split.refAmount.round(baseDecimals);
        } else {
          // Calculate refAmount based on exchange rate
          refAmount = await calculateRefAmount({
            userId,
            definitionOwnerUserId: accountOwnerUserId,
            amount: split.amount,
            baseCode: transactionCurrencyCode,
            quoteCode: baseCurrency.code,
            date: transactionTime,
          });
        }
      }

      return {
        transactionId,
        userId,
        categoryId: split.categoryId,
        amount: split.amount,
        refAmount,
        note: split.note || null,
      };
    }),
  );

  // If a category with refunds is being removed, relink those refunds to main transaction
  for (const [categoryId, { refundIds }] of refundsByCategoryId) {
    const stillExists = splits.some((s) => s.categoryId === categoryId);
    if (!stillExists) {
      // Move refunds from this split to transaction-level (set splitId to null)
      await RefundTransactions.update({ splitId: null }, { where: { id: refundIds } });
    }
  }

  // Delete existing splits and create new ones (atomic replacement)
  await deleteSplitsForTransaction({ transactionId });
  const createdSplits = await bulkCreateSplits({ data: splitPayloads });

  // Point each refund at the freshly inserted split carrying its category. Categories that
  // were dropped from the payload have no new split, so their refunds stay transaction-level.
  for (const newSplit of createdSplits) {
    const existingRefundInfo = refundsByCategoryId.get(newSplit.categoryId);
    if (existingRefundInfo) {
      await RefundTransactions.update({ splitId: newSplit.id }, { where: { id: existingRefundInfo.refundIds } });
    }
  }

  return createdSplits;
};
