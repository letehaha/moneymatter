import { logger } from '@js/utils/logger';
import * as RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';
import * as Transactions from '@models/transactions.model';
import { attachRefundedAmounts } from '@services/tx-refunds/attach-refunded-amounts';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';

interface GetRefundParams {
  userId: number;
  transactionId: string;
}

export const getRefundsForTransactionById = withTransaction(
  async ({ userId, transactionId }: GetRefundParams): Promise<RefundTransactions.default[]> => {
    try {
      const refunds = await RefundTransactions.default.findAll({
        where: {
          userId,
          [Op.or]: [
            {
              originalTxId: transactionId,
            },
            {
              refundTxId: transactionId,
            },
          ],
        },
        include: [
          {
            model: Transactions.default,
            as: 'originalTransaction',
            where: { userId },
            // Optional so links to a purchase outside the app (NULL originalTxId) are returned too.
            required: false,
            include: [{ model: TransactionSplits, as: 'splits' }],
          },
          {
            model: Transactions.default,
            as: 'refundTransaction',
            where: { userId },
          },
        ],
      });

      await attachRefundedAmounts({
        transactions: refunds.flatMap((r) => (r.originalTransaction ? [r.originalTransaction] : [])),
      });

      return refunds;
    } catch (e) {
      logger.error({ message: 'Error retrieving refunds for transaction:', error: e as Error });
      throw e;
    }
  },
);
