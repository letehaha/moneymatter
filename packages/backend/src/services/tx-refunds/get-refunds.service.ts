import { TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import * as RefundTransactions from '@models/refund-transactions.model';
import { liveOrExternalTransactionSql } from '@models/transactions-query/deletion-where';
import * as Transactions from '@models/transactions.model';
import { Op, type WhereOptions, literal } from 'sequelize';

interface FiltersStructure {
  categoryId?: string;
  transactionType?: TRANSACTION_TYPES;
  accountId?: string;
}

export interface GetRefundTransactionsParams extends FiltersStructure {
  userId: number;
  page?: number;
  limit?: number;
}

export const getRefundTransactions = async ({
  userId,
  categoryId,
  transactionType,
  accountId,
  page = 1,
  limit = 2,
}: GetRefundTransactionsParams): Promise<{
  rows: RefundTransactions.default[];
  meta: { total: number; page: number; limit: number };
}> => {
  try {
    const transactionWhereClause: WhereOptions<FiltersStructure> = {};

    if (categoryId) {
      transactionWhereClause.categoryId = categoryId;
    }

    if (transactionType) {
      transactionWhereClause.transactionType = transactionType;
    }

    if (accountId) {
      transactionWhereClause.accountId = accountId;
    }

    const { rows, count: total } = await RefundTransactions.default.findAndCountAll({
      where: {
        userId,
        [Op.and]: literal(liveOrExternalTransactionSql({ idColumnSql: '"RefundTransactions"."originalTxId"' })),
      },
      include: [
        {
          model: Transactions.default,
          as: 'originalTransaction',
          // An empty `where` still makes Sequelize require the join, which would hide
          // refunds that legitimately have no original transaction.
          ...(Object.keys(transactionWhereClause).length
            ? { where: transactionWhereClause, required: true }
            : { required: false }),
        },
        {
          model: Transactions.default,
          as: 'refundTransaction',
          required: true,
        },
      ],
      limit,
      offset: (page - 1) * limit,
    });

    return { rows, meta: { total, page, limit } };
  } catch (e) {
    logger.error({ message: 'Error retrieving refund transactions:', error: e as Error });
    throw e;
  }
};
