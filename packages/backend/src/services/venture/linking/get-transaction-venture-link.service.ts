import type { TransactionVentureLink } from '@bt/shared/types/venture';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';

interface GetTransactionVentureLinkParams {
  userId: number;
  transactionId: string;
}

export const getTransactionVentureLink = async ({
  userId,
  transactionId,
}: GetTransactionVentureLinkParams): Promise<TransactionVentureLink> => {
  const link = await findOrThrowNotFound({
    query: VentureEventLinks.findOne({
      where: { transactionId },
      include: [
        {
          model: VentureEvents,
          as: 'event',
          where: { userId },
          // paranoid:false so the link still resolves a name for a soft-deleted deal.
          include: [{ model: VentureDeals, as: 'deal', paranoid: false }],
        },
      ],
    }),
    message: t({ key: 'venture.eventNotFound' }),
  });

  const deal = link.event!.deal!;

  return {
    dealId: deal.id,
    dealName: deal.name,
    isDealDeleted: deal.deletedAt != null,
  };
};
