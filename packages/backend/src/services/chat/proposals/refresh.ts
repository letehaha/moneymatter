import type { ChatProposalCard, ChatProposalStatus } from '@bt/shared/types';
import ChatProposals from '@models/chat-proposals.model';
import { withTransaction } from '@services/common/with-transaction';

import { resolveToolPolicy } from '../policies';
import { notifyThreadUpdated } from '../threads/thread-events';
import { cardConflict } from './card-conflict';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';
import { computeCardState } from './card-state';
import { loadParentRows } from './parents';

/** A refresh brings back a card that went stale or failed, or re-reads one that is still waiting. */
const REFRESHABLE: readonly ChatProposalStatus[] = ['pending', 'stale', 'failed'];

type RefreshOutcome =
  | { kind: 'refreshed'; threadId: string }
  | { kind: 'conflict'; reason: 'notPending' | 'expired' | 'unavailable' };

const refreshTransaction = withTransaction(
  async ({ userId, proposalId }: { userId: number; proposalId: string }): Promise<RefreshOutcome> => {
    const row = await findOwnedProposal({ userId, proposalId, lock: true });
    if (isExpiryDue({ row })) {
      await expireDueCards({ ids: [proposalId] });
      return { kind: 'conflict', reason: 'expired' };
    }
    if (!REFRESHABLE.includes(row.status)) {
      return { kind: 'conflict', reason: row.status === 'expired' ? 'expired' : 'notPending' };
    }

    const policy = resolveToolPolicy({ name: row.toolName, args: row.args });
    if (!policy) return { kind: 'conflict', reason: 'unavailable' };

    const parents = await loadParentRows({ ids: row.dependsOn, userId, threadId: row.threadId });
    const state = await computeCardState({
      userId,
      policy,
      args: row.args,
      parents: parents.map((parent) => ({ id: parent.id as string, status: parent.status })),
    });

    await ChatProposals.update(
      {
        status: 'pending',
        statusReason: null,
        danger: policy.danger,
        confirmation: state.confirmation.mode,
        confirmationPhrase: state.confirmation.phrase ?? null,
        preview: state.preview,
        error: state.error,
        snapshot: state.snapshot,
        revision: row.revision + 1,
      },
      { where: { id: proposalId } },
    );

    return { kind: 'refreshed', threadId: row.threadId };
  },
);

/**
 * Recomputes a card's preview and snapshot against the data as it is now and returns it to
 * `pending` with the next revision, so the user sees what changed and approves that.
 */
export async function refreshProposal({
  userId,
  proposalId,
}: {
  userId: number;
  proposalId: string;
}): Promise<ChatProposalCard> {
  const outcome = await refreshTransaction({ userId, proposalId });
  if (outcome.kind === 'conflict') throw await cardConflict({ userId, targetId: proposalId, reason: outcome.reason });

  notifyThreadUpdated({ userId, threadId: outcome.threadId });
  const [card] = await loadCards({ userId, ids: [proposalId] });
  return card!;
}
