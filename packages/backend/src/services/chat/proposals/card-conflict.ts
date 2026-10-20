import type { ChatCardConflictDetails, ChatCardConflictReason } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';

import { loadCards } from './card-load';

const CONFLICT_MESSAGE_KEYS: Record<ChatCardConflictReason, string> = {
  revision: 'chat.cardRevisionMoved',
  notPending: 'chat.cardNotPending',
  blocked: 'chat.cardBlocked',
  expired: 'chat.cardExpired',
  stale: 'chat.cardStale',
  unavailable: 'chat.cardUnavailable',
};

const detailsFor = async ({
  userId,
  targetId,
  chainIds,
  reason,
  stale,
}: {
  userId: number;
  targetId: string;
  chainIds: string[];
  reason: ChatCardConflictDetails['reason'];
  stale?: ChatCardConflictDetails['stale'];
}): Promise<Record<string, unknown> | null> => {
  const cards = await loadCards({ userId, ids: [targetId, ...chainIds] });
  const card = cards.find((candidate) => candidate.id === targetId);
  return card ? ({ reason, card, cards, ...(stale ? { stale } : {}) } satisfies ChatCardConflictDetails) : null;
};

/**
 * The 409 for an action the card's state refuses. `details` carries the card as it is now and the
 * cards of its chain, so a client replaces what it showed and asks the user again.
 */
export async function cardConflict({
  userId,
  targetId,
  chainIds = [],
  reason,
  stale,
}: {
  userId: number;
  targetId: string;
  chainIds?: string[];
  reason: ChatCardConflictReason;
  stale?: ChatCardConflictDetails['stale'];
}): Promise<ConflictError> {
  const details = await detailsFor({ userId, targetId, chainIds, reason, stale });
  return new ConflictError({
    message: t({ key: CONFLICT_MESSAGE_KEYS[reason] }),
    ...(details ? { details } : {}),
  });
}

/** The 422 for a handler that threw: the message is the handler's, the cards are marked failed already. */
export async function cardFailure({
  userId,
  targetId,
  chainIds = [],
  message,
}: {
  userId: number;
  targetId: string;
  chainIds?: string[];
  message: string;
}): Promise<ValidationError> {
  const details = await detailsFor({ userId, targetId, chainIds, reason: 'failed' });
  return new ValidationError({ message, ...(details ? { details } : {}) });
}
