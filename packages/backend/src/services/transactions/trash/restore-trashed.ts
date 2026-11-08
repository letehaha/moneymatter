import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, isTwoLegTransfer } from '@bt/shared/types';
import type { RecordId, RestoreTrashResponse } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import RefundTransactions from '@models/refund-transactions.model';
import { findOneTransaction, updateTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { runInSavepoint } from '@services/common/run-in-savepoint';
import { withTransaction } from '@services/common/with-transaction';
import { assertLoanPaymentAllowed } from '@services/loans/assert-loan-payment-allowed';
import { assertNotInPayment } from '@services/transactions/payment-legs';
import { rejectIfAny } from '@services/transactions/reconciliation/helpers';
import { syncRefundLinkedFlags } from '@services/tx-refunds/sync-refund-linked-flags';
import { validateRefundLinks } from '@services/tx-refunds/validate-refund-links';
import { ForeignKeyConstraintError, Op } from 'sequelize';

import { loadTrashedLegs } from './load-trashed-legs';

const ANY_ROW = { planned: 'include', access: 'unscoped-internal', balanceAdjustments: 'include' } as const;

const isLoanLeg = ({ leg }: { leg: Transactions }) =>
  leg.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan &&
  leg.transactionType === TRANSACTION_TYPES.income;

/**
 * The live side may have changed while this row was in the Trash (became a transfer, joined a
 * payment, took other refunds). Links are re-inserted one by one, oldest first, under their own
 * id; a link that no longer fits next to the ones already back is dropped.
 */
const recheckRefundLinks = async ({ id }: { id: string }): Promise<{ touchedIds: string[]; dropped: number }> => {
  const links = await RefundTransactions.findAll({
    where: { [Op.or]: [{ originalTxId: id }, { refundTxId: id }] },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  if (!links.length) return { touchedIds: [id], dropped: 0 };

  await RefundTransactions.destroy({ where: { id: { [Op.in]: links.map((link) => link.id) } } });

  let dropped = 0;
  for (const link of links) {
    const pairIds = [link.originalTxId, link.refundTxId].filter((txId): txId is RecordId => Boolean(txId));
    try {
      await runInSavepoint(async () => {
        await RefundTransactions.create({
          id: link.id,
          userId: link.userId,
          originalTxId: link.originalTxId,
          refundTxId: link.refundTxId,
          splitId: link.splitId,
          amount: link.amount,
          createdAt: link.get('createdAt'),
        });
        await validateRefundLinks({ userId: link.userId, txId: id });
        await assertNotInPayment({ transactionIds: pairIds });
      });
    } catch (error) {
      // A foreign key error means the counterpart was purged meanwhile.
      if (!(error instanceof ValidationError || error instanceof ForeignKeyConstraintError)) throw error;
      dropped++;
      logger.warn('Refund link dropped on trash restore', {
        linkId: link.id,
        txId: id,
        counterpartId: link.originalTxId === id ? link.refundTxId : link.originalTxId,
        reason: error.message,
      });
    }
  }

  const touchedIds = [id, ...links.flatMap((link) => [link.originalTxId, link.refundTxId])].filter(
    (txId): txId is string => Boolean(txId),
  );
  return { touchedIds, dropped };
};

export const restoreTrashed = withTransaction(
  async ({ userId, transactionIds }: { userId: number; transactionIds: string[] }): Promise<RestoreTrashResponse> => {
    const legs = await loadTrashedLegs({ userId, transactionIds });

    const accounts = await Accounts.findAll({
      where: { id: { [Op.in]: [...new Set(legs.map((leg) => leg.accountId))] } },
      attributes: ['id', 'type', 'userId'],
    });
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    rejectIfAny({
      rows: legs.filter((leg) => accountById.get(leg.accountId)?.type !== leg.accountType),
      key: 'transactions.trash.accountTypeChanged',
    });

    const legsPerTransfer = Map.groupBy(legs, (leg) => leg.transferId);
    const isTwinGone = ({ leg }: { leg: Transactions }) =>
      isTwoLegTransfer(leg.transferNature) && legsPerTransfer.get(leg.transferId)!.length === 1;
    // A managed loan only holds transfer_to_loan income legs; a lone one cannot become a plain row there.
    rejectIfAny({
      rows: legs.filter((leg) => isLoanLeg({ leg }) && isTwinGone({ leg })),
      key: 'transactions.trash.loanPaymentLegMissing',
    });

    // Sequential: each balance re-apply locks the leg's account row.
    for (const leg of legs) {
      const twinGone = isTwinGone({ leg });

      if (!leg.isPlanned && isLoanLeg({ leg })) {
        await assertLoanPaymentAllowed({
          ownerUserId: accountById.get(leg.accountId)!.userId,
          loanAccountId: leg.accountId,
          newLegAmount: leg.amount,
          paymentDate: leg.time,
        });
      }

      await updateTransactions({
        ...ANY_ROW,
        values: {
          deletedAt: null,
          deletionReason: null,
          ...(twinGone && { transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet, transferId: null }),
        },
        where: { id: leg.id },
        paranoid: false,
        hooks: false,
      });

      if (leg.isPlanned) continue;
      const restored = await findOneTransaction({ ...ANY_ROW, where: { id: leg.id } });
      await Transactions.applyRestoredBalance(restored!);
    }

    const refundTouchedIds: string[] = [];
    let droppedRefundLinks = 0;
    for (const leg of legs) {
      const { touchedIds, dropped } = await recheckRefundLinks({ id: leg.id });
      refundTouchedIds.push(...touchedIds);
      droppedRefundLinks += dropped;
    }
    await syncRefundLinkedFlags({ transactionIds: refundTouchedIds });

    return { restoredIds: legs.map((leg) => leg.id), droppedRefundLinks };
  },
);
