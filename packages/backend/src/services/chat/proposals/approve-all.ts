import type {
  ChatApproveAllOutcome,
  ChatApproveAllResponse,
  ChatApproveAllResult,
  ChatProposalCard,
} from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import ChatMessages from '@models/chat-messages.model';
import ChatProposals from '@models/chat-proposals.model';
import type Users from '@models/users.model';

import { isSafeForApproveAll } from '../policies/safe-cards';
import { approveProposal } from './approve';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { buildCards, loadCards } from './card-load';

type ApprovalUser = Pick<Users, 'id' | 'username' | 'authUserId' | 'role'>;

/** Why a card that is not safe is left for the user, as the key the card shows. */
function reasonKeyFor({ card }: { card: ChatProposalCard }): string {
  if (card.status !== 'pending') return 'chat.cards.notPending';
  if (card.stale) return card.stale.reasonKey;
  if (!card.canApply.ok) return card.canApply.reasonKey;
  if (card.egress) return 'chat.cards.needsHostConfirmation';
  if (card.confirmation.mode !== 'none' || card.danger !== 'none') return 'chat.cards.needsConfirmation';
  if (card.fields.some((field) => field.uncertain)) return 'chat.cards.hasUncertainFields';
  return 'chat.cards.needsReview';
}

async function approveOne({
  user,
  card,
  revisions,
}: {
  user: ApprovalUser;
  card: ChatProposalCard;
  revisions: Record<string, number>;
}): Promise<{ result: ChatApproveAllResult; appliedIds: string[] }> {
  const outcome = ({
    kind,
    reasonKey,
    appliedIds = [],
  }: {
    kind: ChatApproveAllOutcome;
    reasonKey?: string;
    appliedIds?: string[];
  }) => ({
    result: { proposalId: card.id, outcome: kind, ...(reasonKey ? { reasonKey } : {}) },
    appliedIds,
  });

  try {
    const response = await approveProposal({
      user,
      proposalId: card.id,
      revision: revisions[card.id]!,
      parentRevisions: revisions,
    });
    return outcome({
      kind: 'applied',
      appliedIds: response.cards.filter((applied) => applied.status === 'applied').map((applied) => applied.id),
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      const details = error.details as { reason?: string; stale?: { reasonKey: string } } | undefined;
      return details?.reason === 'stale'
        ? outcome({ kind: 'stale', reasonKey: details.stale?.reasonKey })
        : outcome({ kind: 'conflict', reasonKey: `chat.cards.${details?.reason ?? 'notPending'}` });
    }
    // A handler that failed rolled the whole chain back and marked its cards; the pass goes on.
    if (error instanceof ValidationError) return outcome({ kind: 'failed', reasonKey: 'chat.cards.applyFailed' });
    throw error;
  }
}

/**
 * Applies every safe pending card of an assistant message, each chain in its own approval
 * transaction, with the revisions the user saw. A card that is not safe stays pending and is named
 * in the response with the reason. A card whose data moved since the user saw it comes back stale.
 */
export async function approveAllSafeCards({
  user,
  messageId,
  revisions,
}: {
  user: ApprovalUser;
  messageId: string;
  revisions: Record<string, number>;
}): Promise<ChatApproveAllResponse> {
  await findOrThrowNotFound({
    query: ChatMessages.findOne({ where: { id: messageId, userId: user.id, role: 'assistant' } }),
    message: t({ key: 'chat.messageNotFound' }),
  });

  const loadRows = () =>
    ChatProposals.findAll({
      where: { messageId, userId: user.id },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });
  let rows = await loadRows();
  const due = rows.filter((row) => isExpiryDue({ row })).map((row) => row.id as string);
  if (due.length > 0) {
    await expireDueCards({ ids: due });
    rows = await loadRows();
  }

  const cards = await buildCards({ userId: user.id, rows });
  const safeIds = new Set(cards.filter((card) => isSafeForApproveAll({ card, cards })).map((card) => card.id));

  const results: ChatApproveAllResult[] = [];
  const applied = new Set<string>();

  for (const card of cards) {
    if (!safeIds.has(card.id)) {
      results.push({ proposalId: card.id, outcome: 'skipped', reasonKey: reasonKeyFor({ card }) });
      continue;
    }
    if (applied.has(card.id)) {
      results.push({ proposalId: card.id, outcome: 'applied' });
      continue;
    }
    if (revisions[card.id] === undefined) {
      results.push({ proposalId: card.id, outcome: 'skipped', reasonKey: 'chat.cards.notSeen' });
      continue;
    }

    const { result, appliedIds } = await approveOne({ user, card, revisions });
    for (const id of appliedIds) applied.add(id);
    results.push(result);
  }

  return { results, cards: await loadCards({ userId: user.id, ids: rows.map((row) => row.id as string) }) };
}
