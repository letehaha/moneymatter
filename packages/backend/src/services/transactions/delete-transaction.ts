import { isTwoLegTransfer, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { UnexpectedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import RefundTransactions from '@models/refund-transactions.model';
import * as Transactions from '@models/transactions.model';
import { deletePortfolioTransfer } from '@services/investments/portfolios/transfers';
import { assertSharedWritePhase1Guards } from '@services/sharing/auth/authorize-account-write.service';
import { syncRefundLinkedFlags } from '@services/tx-refunds/sync-refund-linked-flags';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { getWritableTransactionById } from './get-by-id';
import { assertPlannedWriteAllowed } from './planned-matching/assert-planned-invariants';

export const deleteTransaction = withTransaction(
  async ({ id, userId }: { id: string; userId: number }): Promise<void> => {
    try {
      // Single fetch + write-authorization gate. `getWritableTransactionById` throws 404
      // when the caller has no claim, 401 when scope: 'own' is violated. Returns a
      // pre-resolved `ctx` so the call site doesn't reassemble auth primitives.
      const { tx, ctx } = await getWritableTransactionById({ id, userId });
      const { transferNature, transferId, refundLinked } = tx;

      assertPlannedWriteAllowed({ transaction: tx, callerUserId: userId });

      // Phase-1 guards block recipient deletes that cross into linking semantics
      // (transfers, refunds) — owners pass through and use the existing flows.
      assertSharedWritePhase1Guards({
        isOwner: ctx.isOwner,
        involvesTransfer:
          isTwoLegTransfer(transferNature) ||
          transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio ||
          transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
        involvesRefund: Boolean(refundLinked),
      });

      // Not gated on `refundLinked` — the flag is a cache of the link rows, and a row whose flag
      // drifted false would otherwise keep its links and leave the other end flagged forever.
      await unlinkRefundTransaction({ id });

      // The model's deleteTransactionById filters by `(id, userId)` — pass the row's
      // actual creator userId rather than the caller's so a recipient with `'all'`
      // scope can delete owner-authored rows after the auth gate above.
      const creatorUserId = tx.userId;

      if (
        transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer ||
        // Out of wallet transaction shouldn't have transferId
        (transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet && !transferId) ||
        // Venture-linked transactions are deleted directly; the venture event service
        // is responsible for unlinking its own VentureEventLink before calling this.
        transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture ||
        // Orphaned two-leg transfer whose pair is gone and `transferId` was cleared:
        // no twin to delete alongside, so treat it as a standalone row instead of
        // falling through to the "unexpected" guard below.
        (isTwoLegTransfer(transferNature) && !transferId)
      ) {
        await Transactions.deleteTransactionById({ id, userId: creatorUserId });
      } else if (transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio) {
        // Find linked portfolio transfer via PortfolioTransfers.transactionId
        const linkedTransfer = await PortfolioTransfers.findOne({
          where: { transactionId: id },
        });

        // Delete linked portfolio transfer (reverses portfolio balance) and the
        // account transaction together. Passing deleteLinkedTransaction: true tells
        // deletePortfolioTransfer to also remove the account transaction row.
        // Portfolio-transfer-on-shared-account is owner-only (recipients are blocked
        // above), so `userId` here is always both caller and creator.
        if (linkedTransfer) {
          await deletePortfolioTransfer({ userId, transferId: linkedTransfer.id, deleteLinkedTransaction: true });
        } else {
          await Transactions.deleteTransactionById({ id, userId: creatorUserId });
        }
      } else if (isTwoLegTransfer(transferNature) && transferId) {
        // Find both legs of the pair by transferId only. Cross-user transfers (created
        // through a household share) have legs that live under different `userId`s, so a
        // userId-scoped lookup would silently orphan the partner row. The caller's
        // authorization is already gated above by `getWritableTransactionById` —
        // touching the linked twin is implicit transfer semantics.
        const transferTransactions = await Transactions.default.findAll({
          where: { transferId },
        });

        // Sequential: a leg on a bank-linked account rejects the delete, and the rollback
        // must not race the other leg's queries.
        for (const transferTx of transferTransactions) {
          await Transactions.deleteTransactionById({ id: transferTx.id, userId: transferTx.userId });
        }
      } else {
        logger.error(`Unexpected issue when tried to delete transaction with id ${id}`);
        throw new UnexpectedError({ message: t({ key: 'transactions.unexpectedDeleteIssue' }) });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        logger.error(e as Error);
      }
      throw e;
    }
  },
);

/**
 * Drops every refund link touching this transaction, then recomputes the flag on the transactions
 * at the other end. A purchase can carry several partial refunds, so all of them are released.
 *
 * Both foreign keys would cascade the links away anyway, but that happens only once the row is
 * actually deleted — too late to read the counterparts off the links or to recompute their flag
 * from a state where the links are already gone.
 */
const unlinkRefundTransaction = withTransaction(async ({ id }: { id: string }) => {
  const links = await RefundTransactions.findAll({
    where: {
      [Op.or]: [{ originalTxId: id }, { refundTxId: id }],
    },
  });

  if (!links.length) return;

  const counterpartIds = links.flatMap((link) => [link.originalTxId, link.refundTxId]).filter((txId) => txId !== id);

  await RefundTransactions.destroy({ where: { id: { [Op.in]: links.map((link) => link.id) } } });

  await syncRefundLinkedFlags({ transactionIds: counterpartIds });
});
