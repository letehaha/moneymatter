import { VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import { withTransaction } from '@services/common/with-transaction';

import { syncDealFromEvents } from '../deals/sync-deal-from-events.service';
import { findVentureDealOrThrow, findVentureEventOrThrow } from '../helpers';
import { findInitialInvestment } from './event-helpers';
import { prepareEventValues } from './prepare-event-values';

interface UpdateVentureEventParams {
  userId: number;
  eventId: string;
  eventDate?: string;
  grossAmount?: string | null;
  navAfter?: string | null;
  quantityPct?: string | null;
  notes?: string | null;
  /** If provided, sets gpCarry and marks `gpCarryOverridden=true`. */
  gpCarryAmount?: string | null;
  /** If provided, sets lpNet and marks `lpNetAmountOverridden=true`. */
  lpNetAmount?: string | null;
  /** When true, clears `*Overridden` flags and re-runs auto-compute. */
  resetOverrides?: boolean;
}

const updateVentureEventImpl = async (params: UpdateVentureEventParams) => {
  const { userId, eventId } = params;

  const event = await findVentureEventOrThrow({ id: eventId, userId });

  const deal = await findVentureDealOrThrow({ id: event.dealId, userId });

  const previousEventDate = event.eventDate;

  const nextEventDate = params.eventDate ?? event.eventDate;
  const nextNotes = params.notes !== undefined ? params.notes : event.notes;

  // Decide whether overrides are being applied or reset
  const shouldReset = params.resetOverrides === true;
  const gpCarryOverride = shouldReset
    ? null
    : params.gpCarryAmount !== undefined
      ? params.gpCarryAmount
      : event.gpCarryOverridden
        ? event.gpCarryAmount
          ? event.gpCarryAmount.toDecimalString(10)
          : null
        : null;
  const lpNetOverride = shouldReset
    ? null
    : params.lpNetAmount !== undefined
      ? params.lpNetAmount
      : event.lpNetAmountOverridden
        ? event.lpNetAmount
          ? event.lpNetAmount.toDecimalString(10)
          : null
        : null;

  // Pull all events for the deal so prepare can compute the carry chain
  const priorEvents = await VentureEvents.findAll({ where: { dealId: deal.id } });

  // Maintain the chronology invariant: every event must sit on/after the
  // initial_investment date. We check on every eventDate change — moving an
  // initial earlier than later events, or pushing a later event before the
  // initial, would both violate it.
  if (params.eventDate !== undefined && params.eventDate !== previousEventDate) {
    if (event.type === VENTURE_EVENT_TYPE.initial_investment) {
      const conflicting = priorEvents.find((e) => e.id !== event.id && e.eventDate < params.eventDate!);
      if (conflicting) {
        throw new ValidationError({
          message: `Initial investment date cannot be later than existing event on ${conflicting.eventDate}.`,
        });
      }
    } else {
      const initial = findInitialInvestment(priorEvents);
      if (initial && params.eventDate < initial.eventDate) {
        throw new ValidationError({
          message: `Event date (${params.eventDate}) cannot be before the initial investment date (${initial.eventDate}).`,
        });
      }
    }
  }

  const prepared = await prepareEventValues({
    userId,
    deal,
    type: event.type,
    eventDate: nextEventDate,
    grossAmount:
      params.grossAmount !== undefined
        ? params.grossAmount
        : event.grossAmount
          ? event.grossAmount.toDecimalString(10)
          : null,
    navAfter:
      params.navAfter !== undefined ? params.navAfter : event.navAfter ? event.navAfter.toDecimalString(10) : null,
    quantityPct: params.quantityPct !== undefined ? params.quantityPct : event.quantityPct,
    priorEvents,
    excludeEventId: event.id,
    lpNetAmountOverride: lpNetOverride,
    gpCarryOverride: gpCarryOverride,
  });

  await event.update({
    eventDate: nextEventDate,
    grossAmount: prepared.grossAmount !== null ? Money.fromDecimal(prepared.grossAmount) : null,
    gpCarryAmount: prepared.gpCarryAmount !== null ? Money.fromDecimal(prepared.gpCarryAmount) : null,
    lpNetAmount: prepared.lpNetAmount !== null ? Money.fromDecimal(prepared.lpNetAmount) : null,
    refAmount: prepared.refAmount !== null ? Money.fromDecimal(prepared.refAmount) : null,
    navAfter: prepared.navAfter !== null ? Money.fromDecimal(prepared.navAfter) : null,
    quantityPct: prepared.quantityPct,
    lpNetAmountOverridden: prepared.lpNetAmountOverridden,
    gpCarryOverridden: prepared.gpCarryOverridden,
    principalReturnedThisEvent: prepared.principalReturnedThisEvent,
    notes: nextNotes,
    metaData: { ...event.metaData, ...prepared.metaDataExtras },
  });

  // Cascade only kicks in for carry-bearing event changes that shift principalRemaining,
  // OR when a non-carry cash event's grossAmount changed (capital_call/fee_payment/capital_refund affect costBasis).
  const earliestImpactedDate = previousEventDate < nextEventDate ? previousEventDate : nextEventDate;
  const { recomputedEventIds } = await syncDealFromEvents({
    userId,
    deal,
    mutatedAtDate: earliestImpactedDate,
  });

  const reloaded = await event.reload({
    include: [{ model: VentureEventLinks, as: 'links' }],
  });

  return { event: reloaded, recomputedEventIds };
};

export const updateVentureEvent = withTransaction(updateVentureEventImpl);
