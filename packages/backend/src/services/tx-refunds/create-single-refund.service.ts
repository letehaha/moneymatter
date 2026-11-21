import type { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { getAccountOwnerUserId } from '@models/accounts.model';
import * as RefundTransactions from '@models/refund-transactions.model';
import * as TransactionSplits from '@models/transaction-splits.model';
import * as Transactions from '@models/transactions.model';
import { assertNotInPayment } from '@services/transactions/payment-legs';
import { roundPositiveAmount } from '@services/transactions/round-positive-amount';
import { Op, UniqueConstraintError } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { validateRefundLinks } from './validate-refund-links';

interface CreateSingleRefundParams {
  userId: number;
  originalTxId: string | null;
  refundTxId: string;
  splitId?: string;
  // Share of the refund transaction this link covers; omitted means the whole refund transaction.
  amount?: Money | null;
}

/**
 * Creates a single refund transaction for an original transaction.
 * There's following rules when creating is disallowed:
 * 1. When base_tx or refund_tx cannot be found.
 * 2. The same refund is already linked to the same original.
 * 3. Any rule of `validateRefundLinks` fails once the link exists.
 */
export const createSingleRefund = withTransaction(
  async ({
    userId,
    originalTxId,
    refundTxId,
    splitId,
    amount,
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

      await assertNotInPayment({ transactionIds: originalTxId ? [originalTxId, refundTxId] : [refundTxId] });

      // Validate splitId if provided
      if (splitId) {
        if (!originalTxId) {
          throw new ValidationError({
            message: 'splitId can only be provided when originalTxId is specified',
          });
        }

        const targetSplit = await findOrThrowNotFound({
          query: TransactionSplits.getSplitById({ id: splitId, userId }),
          message: 'Split not found',
        });

        if (targetSplit.transactionId !== originalTxId) {
          throw new ValidationError({
            message: 'Split does not belong to the original transaction',
          });
        }
      }

      if (originalTx?.id === refundTx.id) {
        throw new ValidationError({
          message: 'Attempt to link a single transaction to itself.',
        });
      }

      // The share is an entered amount in the refund transaction's currency, so it rounds half-up to that
      // currency's decimals (the account owner's definition); one that rounds to nothing is rejected.
      let share = amount;
      if (amount) {
        share = await roundPositiveAmount({
          money: amount,
          userId: await getAccountOwnerUserId({ id: refundTx.accountId }),
          currencyCode: refundTx.currencyCode,
        });
      }

      const duplicateLink = await RefundTransactions.default.findOne({
        where: { refundTxId, originalTxId, userId },
      });

      if (duplicateLink) {
        throw new ValidationError({ message: t({ key: 'transactions.refunds.duplicateLink' }) });
      }

      const refundTransaction = await RefundTransactions.createRefundTransaction({
        originalTxId,
        refundTxId,
        userId,
        splitId,
        amount: share && share.equals(refundTx.amount.abs()) ? null : share,
      }).catch((error) => {
        if (error instanceof UniqueConstraintError) {
          throw new ValidationError({ message: t({ key: 'transactions.refunds.duplicateLink' }) });
        }
        throw error;
      });

      await validateRefundLinks({ userId, txId: refundTxId });

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
