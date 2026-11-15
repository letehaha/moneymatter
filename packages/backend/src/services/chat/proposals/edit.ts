import type { ChatProposalCard, ChatProposalStatus } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import ChatProposals from '@models/chat-proposals.model';
import { withTransaction } from '@services/common/with-transaction';

import { findToolCatalogEntry } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { notifyThreadUpdated } from '../threads/thread-events';
import { markAccountHistoryMismatch } from './account-history-guard';
import { cardConflict } from './card-conflict';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';
import { computeCardState } from './card-state';
import { resolveParents } from './parents';
import { ToolInputError, validateWithRefs } from './placeholders';

/** A card can be changed while it waits, or after it went stale or failed (the edit refreshes it). */
const EDITABLE: readonly ChatProposalStatus[] = ['pending', 'stale', 'failed'];

type EditOutcome =
  | { kind: 'edited'; threadId: string }
  | { kind: 'conflict'; reason: 'notPending' | 'expired' | 'revision' | 'unavailable' };

const sameValue = ({ a, b }: { a: unknown; b: unknown }) => JSON.stringify(a) === JSON.stringify(b);

const editTransaction = withTransaction(
  async ({
    userId,
    proposalId,
    revision,
    args,
  }: {
    userId: number;
    proposalId: string;
    revision: number;
    args: Record<string, unknown>;
  }): Promise<EditOutcome> => {
    const row = await findOwnedProposal({ userId, proposalId, lock: true });
    if (isExpiryDue({ row })) {
      await expireDueCards({ ids: [proposalId] });
      return { kind: 'conflict', reason: 'expired' };
    }
    if (!EDITABLE.includes(row.status)) {
      return { kind: 'conflict', reason: row.status === 'expired' ? 'expired' : 'notPending' };
    }
    if (row.revision !== revision) return { kind: 'conflict', reason: 'revision' };

    const entry = findToolCatalogEntry({ name: row.toolName });
    const policy = resolveToolPolicy({ name: row.toolName, args });
    if (!entry || !policy) return { kind: 'conflict', reason: 'unavailable' };

    const known = new Set(Object.keys(entry.inputShape ?? {}));
    const unknown = Object.keys(args).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new ValidationError({ message: `${row.toolName} has no argument ${unknown.join(', ')}` });
    }

    // The same checks a proposal passes: the tool's schema and validator, refs standing in for ids not made yet.
    let refs: string[];
    let parents: ChatProposals[];
    try {
      ({ refs } = validateWithRefs({ entry, args }));
      parents = await resolveParents({
        userId,
        threadId: row.threadId,
        proposalId,
        refs,
        policy,
        appliedParents: row.dependsOn,
      });
    } catch (error) {
      if (error instanceof ToolInputError) throw new ValidationError({ message: error.message });
      throw error;
    }

    const state = await computeCardState({
      userId,
      policy,
      args,
      parents: parents.map((parent) => ({ id: parent.id as string, status: parent.status })),
    });
    const changed = [...new Set([...Object.keys(row.args), ...Object.keys(args)])].filter(
      (key) => !sameValue({ a: row.args[key], b: args[key] }),
    );
    // The server's own mark is recomputed against the new account; a payment type the user chose is no guess.
    const stillUnsure = (row.uncertainFields ?? []).filter(
      (field) => !changed.includes(field.field) && field.reason !== 'accountHistoryMismatch',
    );
    const uncertainFields = changed.includes('paymentType')
      ? stillUnsure.length > 0
        ? stillUnsure
        : null
      : await markAccountHistoryMismatch({
          userId,
          toolName: policy.name,
          args,
          targetAccountId: state.preview?.before?.accountId,
          uncertain: stillUnsure.length > 0 ? stillUnsure : null,
        });

    await ChatProposals.update(
      {
        args,
        editedFields: [...new Set([...row.editedFields, ...changed])],
        // A field the user changed is no longer a guess.
        uncertainFields,
        dependsOn: refs,
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

    return { kind: 'edited', threadId: row.threadId };
  },
);

/**
 * Replaces a card's arguments with the user's. The new arguments pass the checks a proposal passes,
 * the preview, snapshot, danger and confirmation are recomputed, and the revision moves on, so an
 * approval of the old version is refused.
 */
export async function editProposal({
  userId,
  proposalId,
  revision,
  args,
}: {
  userId: number;
  proposalId: string;
  revision: number;
  args: Record<string, unknown>;
}): Promise<ChatProposalCard> {
  const outcome = await editTransaction({ userId, proposalId, revision, args });
  if (outcome.kind === 'conflict') throw await cardConflict({ userId, targetId: proposalId, reason: outcome.reason });

  notifyThreadUpdated({ userId, threadId: outcome.threadId });
  const [card] = await loadCards({ userId, ids: [proposalId] });
  return card!;
}
