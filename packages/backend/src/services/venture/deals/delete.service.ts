import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import { withTransaction } from '@services/common/with-transaction';

import { unlinkEventLinks } from '../linking/unlink-tx-from-event.service';

interface DeleteVentureDealParams {
  userId: number;
  dealId: string;
  /** Hard-delete; cascades to all events + event-links via FK CASCADE. */
  force?: boolean;
  /** When true, also deletes the linked transaction rows themselves (not just unlinks). */
  deleteLinkedTransactions?: boolean;
}

const deleteVentureDealImpl = async ({
  userId,
  dealId,
  force = false,
  deleteLinkedTransactions = false,
}: DeleteVentureDealParams) => {
  const deal = await VentureDeals.findOne({
    where: { id: dealId, userId },
    paranoid: false,
  });

  if (!deal) return { success: true };

  const links = await VentureEventLinks.findAll({
    attributes: ['id', 'transactionId'],
    include: [{ association: 'event', where: { dealId: deal.id, userId }, attributes: [], required: true }],
  });
  await unlinkEventLinks({ userId, links, deleteLinkedTransactions });

  await deal.destroy({ force });
  return { success: true };
};

export const deleteVentureDeal = withTransaction(deleteVentureDealImpl);
