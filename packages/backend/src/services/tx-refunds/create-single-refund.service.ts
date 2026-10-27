import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as RefundTransactions from '@models/refund-transactions.model';
import * as TransactionSplits from '@models/transaction-splits.model';
import * as Transactions from '@models/transactions.model';
import { assertNotInPayment } from '@services/transactions/payment-legs';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';

interface CreateSingleRefundParams {
  userId: number;
  originalTxId: string | null;
  refundTxId: string;
  splitId?: string;
}

/**
 * Creates a single refund transaction for an original transaction.
 * There's following rules when creating is disallowed:
 * 1. When base_tx or refund_tx cannot be found.
 * 2. When base_tx and refund_tx have the same transactionType. They should always be opposite
 * 3. Both sides share a currency and the refund `amount` is GREATER than the base tx (or targeted
 *    split) `amount`. Cross-currency pairs are uncapped: each side converts at its own date, so a
 *    legitimate refund can exceed the original once converted.
 * 4. Both sides share a currency and the sum of the same-currency refunds is greater than the base
 *    tx (or targeted split) `amount`. Cross-currency refunds never count toward that sum.
 * 5. Refund over `transfer` transaction. Might be supported in the future, but not now.
 * 6. Refund over existing refund.
 * 7. Either side is a planned transaction.
 *
 * @async
 * @export
 * @param {Object} params
 * @param {number} params.userId - The ID of the user creating the refund.
 * @param {number} params.originalTxId - The ID of the original transaction.
 * @param {number} params.refundTxId - The ID of the refund transaction.
 * @returns {Promise<RefundTransactions>} The created refund transaction.
 * @throws {Error} Throws an error if validation fails or if the operation fails.
 */
export const createSingleRefund = withTransaction(
  async ({
    userId,
    originalTxId,
    refundTxId,
    splitId,
  }: CreateSingleRefundParams): Promise<RefundTransactions.default> => {
    try {
      // Fetch original and refund transactions
      const [originalTx, refundTx] = await Promise.all([
        Transactions.getTransactionById({ userId, id: originalTxId! }),
        findOrThrowNotFound({
          query: Transactions.getTransactionById({ userId, id: refundTxId }),
          message: 'Refund transaction not found',
        }),
      ]);

      if (originalTxId && !originalTx) {
        throw new NotFoundError({
          message: 'Original transaction not found',
        });
      }

      if (originalTx?.isPlanned || refundTx.isPlanned) {
        throw new ValidationError({
          message: t({ key: 'transactions.plannedCannotBeRefundLinked' }),
        });
      }

      await assertNotInPayment({ transactionIds: originalTxId ? [originalTxId, refundTxId] : [refundTxId] });

      // Validate splitId if provided
      let targetSplit: TransactionSplits.default | null = null;
      if (splitId) {
        if (!originalTxId) {
          throw new ValidationError({
            message: 'splitId can only be provided when originalTxId is specified',
          });
        }

        targetSplit = await findOrThrowNotFound({
          query: TransactionSplits.getSplitById({ id: splitId, userId }),
          message: 'Split not found',
        });

        if (targetSplit.transactionId !== originalTxId) {
          throw new ValidationError({
            message: 'Split does not belong to the original transaction',
          });
        }
      }

      if (originalTx) {
        if (originalTx.id === refundTx.id) {
          throw new ValidationError({
            message: 'Attempt to link a single transaction to itself.',
          });
        }

        if (originalTx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
          throw new ValidationError({
            message: 'Original (non-refund) transaction cannot be transfer one.',
          });
        }

        // Check if transaction types are opposite
        if (originalTx.transactionType === refundTx.transactionType) {
          throw new ValidationError({
            message: 'Refund transaction must have the opposite transaction type to the original',
          });
        }

        // Native amounts only, and only when both sides share a currency: the two transactions
        // convert at their own dates, so a cross-currency refund may legitimately exceed the
        // original once converted. A split carries its parent transaction's currency.
        if (originalTx.currencyCode === refundTx.currencyCode) {
          const targetAmount = targetSplit ? targetSplit.amount : originalTx.amount;

          if (refundTx.amount.abs().greaterThan(targetAmount.abs())) {
            throw new ValidationError({
              message: targetSplit
                ? 'Refund amount cannot be greater than the split amount'
                : 'Refund amount cannot be greater than the original transaction amount',
            });
          }
        }
      }

      if (refundTx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
        throw new ValidationError({
          message: 'Refund transaction cannot be a transfer one.',
        });
      }

      if (originalTxId) {
        // Prevent "refund" over "refund"
        const isOriginalTxRefund = await RefundTransactions.default.findOne({
          where: { refundTxId: originalTxId, userId },
        });

        if (isOriginalTxRefund) {
          throw new ValidationError({
            message: 'Cannot refund a "refund" transaction',
          });
        }
      }

      const existingRefund = await RefundTransactions.default.findOne({
        where: { refundTxId: refundTxId, userId },
      });

      if (existingRefund) {
        throw new ValidationError({
          message: '"refundTxId" already marked as a refund.',
        });
      }

      if (originalTxId && originalTx && originalTx.currencyCode === refundTx.currencyCode) {
        // Fetch existing refunds - when targeting a split, only count refunds for that split
        const refundWhereClause: Record<string, unknown> = { originalTxId, userId };
        if (splitId) {
          refundWhereClause.splitId = splitId;
        }

        const existingRefunds = await RefundTransactions.default.findAll({
          where: refundWhereClause,
          include: [{ model: Transactions.default, as: 'refundTransaction' }],
        });

        // Only same-currency legs are comparable natively, so cross-currency ones sit outside
        // the cap entirely — both as the candidate and as already-linked refunds.
        const totalRefundedAmount = Money.sum([
          refundTx.amount.abs(),
          ...existingRefunds
            .filter((refund) => refund.refundTransaction.currencyCode === originalTx.currencyCode)
            .map((refund) => refund.refundTransaction.amount.abs()),
        ]);

        const targetAmount = targetSplit ? targetSplit.amount : originalTx.amount;
        if (totalRefundedAmount.greaterThan(targetAmount.abs())) {
          throw new ValidationError({
            message: targetSplit
              ? 'Total refund amount cannot be greater than the split amount'
              : 'Total refund amount cannot be greater than the original transaction amount',
          });
        }
      }

      // Create the refund transaction link
      const refundTransaction = await RefundTransactions.createRefundTransaction({
        originalTxId,
        refundTxId,
        userId,
        splitId,
      });

      await Transactions.updateTransactions(
        { refundLinked: true },
        { userId, id: { [Op.in]: [originalTxId, refundTxId].filter(Boolean) } },
        { individualHooks: false },
      );

      return refundTransaction;
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        logger.error(e as Error);
      }
      throw e;
    }
  },
);
