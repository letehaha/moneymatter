import { isTwoLegTransfer } from '@bt/shared/types';
import RefundTransactions from '@models/refund-transactions.model';
import { findTransactions } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { withTransaction } from '@services/common/with-transaction';
import { syncRefundLinkedFlags } from '@services/tx-refunds/sync-refund-linked-flags';
import { Op } from 'sequelize';

import { assertTrashable } from './find-non-trashable-ids';

/**
 * Moves an already-authorized row to Trash, together with its transfer twin. Links stay
 * attached and come back on restore. The twin lookup has no user filter: a household
 * transfer's legs belong to different users.
 */
export const trashTransaction = withTransaction(async ({ tx }: { tx: Transactions.default }): Promise<void> => {
  const legs =
    isTwoLegTransfer(tx.transferNature) && tx.transferId
      ? await findTransactions({
          where: { transferId: tx.transferId },
          planned: 'include',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          completeness: 'all',
        })
      : [tx];
  const legIds = legs.map((leg) => leg.id);

  await assertTrashable({ transactionIds: legIds });

  // Sequential: each leg's destroy hooks lock its account row.
  for (const leg of legs) {
    await Transactions.deleteTransactionById({ id: leg.id, userId: leg.userId, trash: true });
  }

  const refundLinks = await RefundTransactions.findAll({
    where: { [Op.or]: [{ originalTxId: { [Op.in]: legIds } }, { refundTxId: { [Op.in]: legIds } }] },
    attributes: ['originalTxId', 'refundTxId'],
  });
  await syncRefundLinkedFlags({
    transactionIds: refundLinks.flatMap((link) => [link.originalTxId, link.refundTxId]),
  });
});
