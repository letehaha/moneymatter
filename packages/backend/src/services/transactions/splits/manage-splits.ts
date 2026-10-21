import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits, {
  CreateSplitPayload,
  bulkCreateSplits,
  deleteSplitsForTransaction,
} from '@models/transaction-splits.model';
import Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';

import { SplitInput } from './types';
import { assertValidSplits } from './validate-splits';

interface ManageSplitsParams {
  transactionId: string;
  /** Caller's userId. Stamped on newly inserted split rows as creator metadata; also
   *  used to fetch the caller's base currency for refAmount conversion. */
  userId: number;
  /** UserId that owns the *categories* split rows reference. Caller for owned-account
   *  writes; account owner for recipient writes on shared accounts. Defaults to `userId`
   *  for back-compat with non-shared callers. */
  categoryOwnerUserId?: number;
  splits: SplitInput[];
  transactionAmount: Money;
  transactionCurrencyCode: string;
  transactionTime: Date;
  transferNature?: string;
}

/**
 * Creates or updates splits for a transaction.
 * Validates splits, deletes existing ones, and creates new ones.
 * Also handles refund link migration when splits are recreated.
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
  categoryOwnerUserId,
  splits: requestedSplits,
  transactionAmount: requestedTransactionAmount,
  transactionCurrencyCode,
  transactionTime,
  transferNature,
}: ManageSplitsParams): Promise<TransactionSplits[]> => {
  // Splits and the transaction they divide are compared and stored at the transaction currency's
  // decimals, so the sum check judges exactly the values that end up in the table.
  const transactionDecimals = await getCurrencyDecimals({
    userId: categoryOwnerUserId ?? userId,
    code: transactionCurrencyCode,
  });
  const transactionAmount = requestedTransactionAmount.round(transactionDecimals);
  const splits = requestedSplits?.map((split) => ({
    ...split,
    amount: split.amount?.round(transactionDecimals) ?? split.amount,
  }));

  // Fetch existing splits — keyed by transactionId; userId is creator metadata only.
  const existingSplits = await TransactionSplits.findAll({
    where: { transactionId },
  });

  // Build a map of categoryId -> refund info for existing splits.
  // `refundIds` holds the RefundTransactions row ids: the old splits get deleted further
  // down, and the FK is ON DELETE SET NULL, so `splitId` stops identifying these rows.
  const refundsByCategoryId = new Map<
    string,
    {
      totalRefundedRefAmount: Money;
      refundIds: string[];
      refundAmounts: { amount: Money; currencyCode: string }[];
    }
  >();

  // Query refunds for each split that exists
  for (const existingSplit of existingSplits) {
    const refunds = await RefundTransactions.findAll({
      where: { splitId: existingSplit.id },
      include: [{ model: Transactions, as: 'refundTransaction' }],
    });

    if (refunds.length > 0) {
      const totalRefunded = Money.sum(refunds.map((r) => r.refundTransaction.refAmount.abs()));
      const refundAmounts = refunds.map((r) => ({
        amount: r.refundTransaction.amount.abs(),
        currencyCode: r.refundTransaction.currencyCode,
      }));
      refundsByCategoryId.set(existingSplit.categoryId, {
        totalRefundedRefAmount: totalRefunded,
        refundIds: refunds.map((r) => r.id),
        refundAmounts,
      });
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
    minSplitAmount: Money.fromDecimal(1).divide(10 ** transactionDecimals),
    categoryOwnerUserId: categoryOwnerUserId ?? userId,
    transferNature: transferNature as Parameters<typeof assertValidSplits>[0]['transferNature'],
  });

  // Get user's base currency for refAmount calculation
  const { currency: baseCurrency } = await UsersCurrencies.getCurrency({
    userId,
    isDefaultCurrency: true,
  });

  const isBaseCurrency = transactionCurrencyCode === baseCurrency.code;
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
            amount: split.amount,
            baseCode: transactionCurrencyCode,
            quoteCode: baseCurrency.code,
            date: transactionTime,
          });
        }
      }

      // Validate: if this category had refunds, new refAmount must be >= total refunded
      const existingRefundInfo = refundsByCategoryId.get(split.categoryId);
      if (existingRefundInfo && refAmount.lessThan(existingRefundInfo.totalRefundedRefAmount)) {
        // Format refund amounts in their original currencies for user-friendly display
        const refundDescriptions = existingRefundInfo.refundAmounts.map(
          (r) => `${r.amount.toNumber().toFixed(2)} ${r.currencyCode}`,
        );
        const refundsText = refundDescriptions.join(', ');
        throw new ValidationError({
          message: t({ key: 'transactions.splits.cannotReduceBelowRefunded', variables: { refundsText } }),
        });
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
