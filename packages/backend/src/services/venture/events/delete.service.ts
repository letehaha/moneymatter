import { VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { ValidationError } from '@js/errors';
import VentureEvents from '@models/venture/venture-events.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { syncDealFromEvents } from '../deals/sync-deal-from-events.service';
import { findVentureDealOrThrow, findVentureEventOrThrow } from '../helpers';
import { unlinkEventLinks } from '../linking/unlink-tx-from-event.service';

interface DeleteVentureEventParams {
  userId: number;
  eventId: string;
  /** When true, also deletes the linked transaction rows themselves (not just unlinks). */
  deleteLinkedTransactions?: boolean;
}

const deleteVentureEventImpl = async ({
  userId,
  eventId,
  deleteLinkedTransactions = false,
}: DeleteVentureEventParams) => {
  const event = await findVentureEventOrThrow({ id: eventId, userId, includeLinks: true });

  const deal = await findVentureDealOrThrow({ id: event.dealId, userId });

  // The initial_investment is the anchor for every other event's cost-basis +
  // chronology check. Removing it while later events still exist would leave
  // those events referencing a deal with no entry point.
  if (event.type === VENTURE_EVENT_TYPE.initial_investment) {
    const otherEventsCount = await VentureEvents.count({
      where: { dealId: event.dealId, id: { [Op.ne]: event.id } },
    });
    if (otherEventsCount > 0) {
      throw new ValidationError({
        message: 'Delete the other events first before deleting the initial investment.',
      });
    }
  }

  const eventDateForCascade = event.eventDate;

  // Unlink before destroying the event: the event delete CASCADEs the link rows and loses the snapshot.
  await unlinkEventLinks({ userId, links: event.links ?? [], deleteLinkedTransactions });

  await event.destroy();

  const { recomputedEventIds } = await syncDealFromEvents({
    userId,
    deal,
    mutatedAtDate: eventDateForCascade,
  });

  return { success: true, recomputedEventIds };
};

export const deleteVentureEvent = withTransaction(deleteVentureEventImpl);
