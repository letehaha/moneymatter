import type { ChatProposalCard } from './proposals';

/**
 * Body of `POST /chat/proposals/:id/approve`. `revision` and `parentRevisions` are the revisions the
 * user saw (the card's and its pending parents'); `confirmation` answers the strictest confirmation
 * of the chain: `confirm`, the host of an egress card, or the affected count of a typed one.
 */
export interface ChatApproveRequest {
  revision: number;
  parentRevisions?: Record<string, number>;
  confirmation?: string;
}

/** Body of `PATCH /chat/proposals/:id`: the complete new argument set of the card, and the revision it was edited from. */
export interface ChatEditProposalRequest {
  revision: number;
  args: Record<string, unknown>;
}

/** Body of `POST /chat/proposals/:id/comment`. */
export interface ChatCommentRequest {
  text: string;
}

/** Body of `POST /chat/messages/:id/approve-all`: the revision of each card the user saw, by card id. */
export interface ChatApproveAllRequest {
  revisions: Record<string, number>;
}

/** The target card of an action and every card of its chain as they are after it, so a client can replace them all. */
export interface ChatCardActionResponse {
  card: ChatProposalCard;
  cards: ChatProposalCard[];
}

export type ChatApproveAllOutcome = 'applied' | 'skipped' | 'conflict' | 'stale' | 'failed';

export interface ChatApproveAllResult {
  proposalId: string;
  outcome: ChatApproveAllOutcome;
  /** Why a card was left: the key of the reason ("needs confirmation", "stale", ...). */
  reasonKey?: string;
}

export interface ChatApproveAllResponse {
  results: ChatApproveAllResult[];
  /** Every card of the message as it is after the pass. */
  cards: ChatProposalCard[];
}

/** An applied card with the thread it lives in, for the "Applied changes" list. */
export interface ChatAppliedChange {
  card: ChatProposalCard;
  threadId: string;
  threadTitle: string;
}

export interface ChatAppliedPage {
  items: ChatAppliedChange[];
  /** The id of the last card of the page, null on the last page. */
  nextCursor: string | null;
}

/** Why an action on a card answered 409, in `details.reason`. */
export type ChatCardConflictReason = 'revision' | 'notPending' | 'blocked' | 'expired' | 'stale' | 'unavailable';

/** `details` of the 409 and 422 answers of the card actions: the card as it is now. */
export interface ChatCardConflictDetails {
  reason: ChatCardConflictReason | 'failed';
  card: ChatProposalCard;
  cards: ChatProposalCard[];
  stale?: { reasonKey: string; before?: unknown; after?: unknown };
}
