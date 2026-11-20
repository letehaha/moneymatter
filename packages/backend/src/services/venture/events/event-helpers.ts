import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import VentureEvents from '@models/venture/venture-events.model';
import Big from 'big.js';
import { differenceInDays } from 'date-fns';

// Cash-bearing events require a `cashFlowMode` other than `none`.
const CASH_FLOW_EVENT_TYPES: readonly VENTURE_EVENT_TYPE[] = [
  VENTURE_EVENT_TYPE.initial_investment,
  VENTURE_EVENT_TYPE.capital_call,
  VENTURE_EVENT_TYPE.distribution,
  VENTURE_EVENT_TYPE.exit,
  VENTURE_EVENT_TYPE.fee_payment,
  VENTURE_EVENT_TYPE.capital_refund,
];

/** Event types that may bear carry (LP-positive cash, GP earns share). */
export const CARRY_BEARING_EVENT_TYPES: readonly VENTURE_EVENT_TYPE[] = [
  VENTURE_EVENT_TYPE.distribution,
  VENTURE_EVENT_TYPE.exit,
];

// NAV-bearing events: must specify navAfter, no cash flow.
const NAV_ONLY_EVENT_TYPES: readonly VENTURE_EVENT_TYPE[] = [
  VENTURE_EVENT_TYPE.nav_update,
  VENTURE_EVENT_TYPE.writedown,
];

/**
 * Sum of LP principal already returned across all distribution/exit events
 * STRICTLY BEFORE the given event (by date asc, then by createdAt asc as a
 * tiebreaker for events on the same day). Used by carry computation.
 *
 * Reads each prior event's `principalReturnedThisEvent` column (written at
 * create/sync time). Carry-bearing events without the snapshot are skipped,
 * which would only happen if the row was inserted outside the standard
 * `prepareEventValues` pipeline.
 */
export function computeCumulativePrincipalReturnedBefore({
  events,
  beforeEvent,
}: {
  events: readonly VentureEvents[];
  beforeEvent: { eventDate: string; id: string | null };
}): string {
  const sorted = [...events].sort((a, b) => {
    const dateCmp = a.eventDate.localeCompare(b.eventDate);
    if (dateCmp !== 0) return dateCmp;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  let cumulative = new Big(0);

  for (const event of sorted) {
    if (event.id === beforeEvent.id) continue;
    if (event.eventDate > beforeEvent.eventDate) continue;
    if (event.type !== VENTURE_EVENT_TYPE.distribution && event.type !== VENTURE_EVENT_TYPE.exit) {
      continue;
    }
    if (event.principalReturnedThisEvent === null) continue;
    cumulative = cumulative.plus(event.principalReturnedThisEvent);
  }

  return cumulative.toFixed(10);
}

/**
 * Years held from investmentDate to eventDate (fractional, never negative).
 */
export function computeYearsHeld({ investmentDate, eventDate }: { investmentDate: string; eventDate: string }): number {
  const invDate = new Date(investmentDate);
  const evtDate = new Date(eventDate);
  const days = differenceInDays(evtDate, invDate);
  return Math.max(days / 365.25, 0);
}

// computeCostBasis lives in `metrics/compute-cost-basis.ts` (canonical home
// for cross-feature pure fns). Re-exported here so prepare-event-values + the
// metrics composite share the same impl.
export { computeCostBasis } from '../metrics/compute-cost-basis';

/**
 * Validates that the user-supplied `cashFlowMode` matches the event type's
 * allowed modes:
 *   - nav_update / writedown → MUST be 'none'
 *   - cash-bearing events    → MUST be 'linked' or 'out_of_wallet'
 */
export function isCashFlowModeAllowed({
  type,
  mode,
}: {
  type: VENTURE_EVENT_TYPE;
  mode: VENTURE_CASH_FLOW_MODE;
}): boolean {
  if (NAV_ONLY_EVENT_TYPES.includes(type)) {
    return mode === VENTURE_CASH_FLOW_MODE.none;
  }
  if (CASH_FLOW_EVENT_TYPES.includes(type)) {
    return mode === VENTURE_CASH_FLOW_MODE.linked || mode === VENTURE_CASH_FLOW_MODE.out_of_wallet;
  }
  return false;
}

/** Locates the deal's initial_investment event (or null) from a loaded event list. */
export function findInitialInvestment(events: readonly VentureEvents[]): VentureEvents | null {
  return events.find((e) => e.type === VENTURE_EVENT_TYPE.initial_investment) ?? null;
}
