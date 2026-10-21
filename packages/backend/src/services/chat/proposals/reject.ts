import type { ChatCardActionResponse, ChatProposalStatus } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import ChatProposals from '@models/chat-proposals.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { notifyThreadUpdated } from '../threads/thread-events';
import { cardConflict } from './card-conflict';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';

/** Cards a user can still turn down: waiting, stale, failed or blocked by a parent. */
const REJECTABLE: readonly ChatProposalStatus[] = ['pending', 'stale', 'failed', 'blocked'];
/** Cards whose parent was rejected can no longer be applied. */
const BLOCKABLE: readonly ChatProposalStatus[] = ['pending', 'stale'];

type RejectOutcome =
  | { kind: 'rejected'; ids: string[]; threadId: string }
  | { kind: 'already'; ids: string[] }
  | { kind: 'conflict'; reason: 'notPending' | 'expired' };

/** The pending cards that refer, directly or through other cards, to `rootId`. */
function dependentsOf({ rootId, rows }: { rootId: string; rows: ChatProposals[] }): ChatProposals[] {
  const blocked = new Set<string>([rootId]);
  const found: ChatProposals[] = [];

  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (blocked.has(row.id as string) || !BLOCKABLE.includes(row.status)) continue;
      if (!row.dependsOn.some((id) => blocked.has(id))) continue;

      blocked.add(row.id as string);
      found.push(row);
      grew = true;
    }
  }

  return found;
}

const rejectTransaction = withTransaction(
  async ({ userId, proposalId }: { userId: number; proposalId: string }): Promise<RejectOutcome> => {
    // The thread is read first, without a lock, to know which siblings to lock with the target.
    const { threadId } = await findOwnedProposal({ userId, proposalId });

    // One query takes the target and every card that may depend on it, ids ascending: the order an
    // approval locks its chain in, so a reject and an approval (or two rejects) queue up instead of
    // each holding a card the other wants.
    const locked = await ChatProposals.findAll({
      where: { userId, threadId, [Op.or]: [{ id: proposalId }, { status: [...BLOCKABLE] }] },
      order: [['id', 'ASC']],
      lock: true,
    });
    const target = locked.find((row) => row.id === proposalId);
    if (!target) throw new NotFoundError({ message: t({ key: 'chat.proposalNotFound' }) });

    if (target.status === 'rejected') return { kind: 'already', ids: [proposalId] };
    if (isExpiryDue({ row: target })) {
      await expireDueCards({ ids: [proposalId] });
      return { kind: 'conflict', reason: 'expired' };
    }
    if (!REJECTABLE.includes(target.status)) {
      return { kind: 'conflict', reason: target.status === 'expired' ? 'expired' : 'notPending' };
    }

    const siblings = locked.filter((row) => BLOCKABLE.includes(row.status));
    const dependents = dependentsOf({ rootId: proposalId, rows: siblings });
    const decidedAt = new Date();

    await ChatProposals.update(
      { status: 'rejected', statusReason: 'rejectedByUser', decidedAt },
      { where: { id: proposalId } },
    );
    if (dependents.length > 0) {
      await ChatProposals.update(
        { status: 'blocked', statusReason: 'parentRejected', decidedAt },
        { where: { id: dependents.map((row) => row.id as string) } },
      );
    }

    return {
      kind: 'rejected',
      ids: [proposalId, ...dependents.map((row) => row.id as string)],
      threadId: target.threadId,
    };
  },
);

/**
 * Turns a card down. Every pending card that depends on it, through any number of parents, is
 * blocked, because it can no longer be applied. Rejecting a rejected card answers it again.
 */
export async function rejectProposal({
  userId,
  proposalId,
}: {
  userId: number;
  proposalId: string;
}): Promise<ChatCardActionResponse> {
  const outcome = await rejectTransaction({ userId, proposalId });
  if (outcome.kind === 'conflict') throw await cardConflict({ userId, targetId: proposalId, reason: outcome.reason });

  if (outcome.kind === 'rejected') notifyThreadUpdated({ userId, threadId: outcome.threadId });
  const cards = await loadCards({ userId, ids: outcome.ids });
  return { card: cards.find((card) => card.id === proposalId)!, cards };
}
