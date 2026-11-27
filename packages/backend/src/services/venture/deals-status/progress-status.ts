import { VENTURE_DEAL_STATUS, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import Big from 'big.js';

/**
 * Recomputes a deal's status from its full event list. Idempotent — always
 * runs against the full set of events, so deletes naturally revert status
 * (no separate "rollback" branch needed).
 *
 * Rules:
 *   - Any `writedown` event with navAfter=0      → written_off
 *   - Any `exit` event with navAfter=0           → fully_exited
 *   - Any other distribution/exit                → partial_exit (any NAV>0)
 *   - Writedown with NAV>0 (no money moved)      → does not progress
 *   - Otherwise (nav_update only, no cash flow)  → unchanged from initial
 *
 * Terminal states (`fully_exited`, `written_off`) are preserved only when
 * the triggering event is still present in the event list. If the user
 * deletes the final exit event, status drops back to partial_exit or
 * outstanding as appropriate.
 *
 * The user can manually override status via PUT /deals/:id — this fn is
 * the auto-progression branch only and is invoked after every event
 * create/update/delete.
 */

interface ProgressStatusEventInput {
  type: VENTURE_EVENT_TYPE;
  navAfter: string | null;
}

const NAV_ZERO_THRESHOLD = '0.0000000001';

function isZeroNav(navAfter: string | null): boolean {
  if (navAfter === null || navAfter === undefined) return false;
  return new Big(navAfter).abs().lte(NAV_ZERO_THRESHOLD);
}

export function progressDealStatus({ events }: { events: readonly ProgressStatusEventInput[] }): VENTURE_DEAL_STATUS {
  let hasWritedownToZero = false;
  let hasExitToZero = false;
  let hasMoneyMovingEvent = false;

  for (const event of events) {
    if (event.type === VENTURE_EVENT_TYPE.writedown && isZeroNav(event.navAfter)) {
      hasWritedownToZero = true;
    }
    if (event.type === VENTURE_EVENT_TYPE.exit && isZeroNav(event.navAfter)) {
      hasExitToZero = true;
    }
    if (event.type === VENTURE_EVENT_TYPE.distribution || event.type === VENTURE_EVENT_TYPE.exit) {
      hasMoneyMovingEvent = true;
    }
  }

  if (hasWritedownToZero) return VENTURE_DEAL_STATUS.written_off;
  if (hasExitToZero) return VENTURE_DEAL_STATUS.fully_exited;
  if (hasMoneyMovingEvent) return VENTURE_DEAL_STATUS.partial_exit;
  return VENTURE_DEAL_STATUS.outstanding;
}
