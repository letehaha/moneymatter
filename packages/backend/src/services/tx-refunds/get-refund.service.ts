import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as RefundTransactions from '@models/refund-transactions.model';
import * as Transactions from '@models/transactions.model';

import { withTransaction } from '../common/with-transaction';

interface GetRefundParams {
  userId: number;
  originalTxId: string;
  refundTxId: string;
}

export const getRefund = withTransaction(
  async ({ userId, originalTxId, refundTxId }: GetRefundParams): Promise<RefundTransactions.default> => {
    try {
      const refundLink = await findOrThrowNotFound({
        query: RefundTransactions.default.findOne({
          where: {
            originalTxId,
            refundTxId,
            userId,
          },
          include: [
            {
              model: Transactions.default,
              as: 'originalTransaction',
              required: true,
            },
            {
              model: Transactions.default,
              as: 'refundTransaction',
              required: true,
            },
          ],
        }),
        message: 'Refund link not found',
      });

      const haveNoAccess =
        refundLink.originalTransaction.userId !== userId || refundLink.refundTransaction.userId !== userId;

      if (haveNoAccess) {
        logger.warn('User tried to access transactions that that dont belong to him.');
        throw new NotFoundError({
          message: 'Refund link not found',
        });
      }

      return refundLink;
    } catch (e) {
      logger.error({ message: 'Error retrieving refund link:', error: e as Error });
      throw e;
    }
  },
);
