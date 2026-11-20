import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import { findIdsInPayments } from '@services/transactions/payment-legs';
import { Op } from 'sequelize';

type NonTrashableReason = 'payment' | 'portfolio' | 'venture';

const REASON_MESSAGE_KEY: Record<NonTrashableReason, string> = {
  payment: 'transactions.trash.paymentNotTrashable',
  portfolio: 'transactions.trash.portfolioNotTrashable',
  venture: 'transactions.trash.ventureNotTrashable',
};

/**
 * Rows that must be unlinked before they can go to Trash. Portfolio and venture are decided by
 * the link row, not `transferNature`: a row whose link is already gone has nothing to unlink
 * and would otherwise stay undeletable.
 */
export const findNonTrashableIds = async ({
  transactionIds,
}: {
  transactionIds: string[];
}): Promise<Map<string, NonTrashableReason>> => {
  const reasons = new Map<string, NonTrashableReason>();
  if (!transactionIds.length) return reasons;

  const where = { transactionId: { [Op.in]: transactionIds } };
  const [paymentIds, portfolioTransfers, ventureLinks] = await Promise.all([
    findIdsInPayments({ transactionIds }),
    PortfolioTransfers.findAll({ where, attributes: ['transactionId'] }),
    VentureEventLinks.findAll({ where, attributes: ['transactionId'] }),
  ]);

  for (const link of ventureLinks) reasons.set(link.transactionId, 'venture');
  for (const transfer of portfolioTransfers) reasons.set(transfer.transactionId!, 'portfolio');
  for (const id of paymentIds) reasons.set(id, 'payment');

  return reasons;
};

export const assertTrashable = async ({ transactionIds }: { transactionIds: string[] }) => {
  const reasons = await findNonTrashableIds({ transactionIds });
  const [reason] = reasons.values();
  if (reason) {
    throw new ValidationError({
      message: t({ key: REASON_MESSAGE_KEY[reason] }),
      details: { transactionIds: [...reasons.keys()] },
    });
  }
};
