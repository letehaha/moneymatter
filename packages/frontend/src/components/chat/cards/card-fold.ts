import type { ChatProposalStatus } from '@bt/shared/types';

/** Statuses after which the card's change is settled one way or another. */
const FINAL_STATUSES: readonly ChatProposalStatus[] = [
  'applied',
  'rejected',
  'failed',
  'blocked',
  'superseded',
  'expired',
];

/**
 * Whether a card starts folded to its header (title and status badge) and a one-line summary. A final card
 * folds, unless it still offers the owner something to do: a failed card that can be refreshed, edited or
 * rejected stays open, so its actions are in view.
 */
export const startsFolded = ({
  status,
  offersAction,
}: {
  status: ChatProposalStatus;
  offersAction: boolean;
}): boolean => FINAL_STATUSES.includes(status) && !offersAction;
