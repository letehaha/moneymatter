import type { ChatCardActionResponse } from '@bt/shared/types';
import ChatProposals from '@models/chat-proposals.model';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { withTransaction } from '@services/common/with-transaction';
import { z } from 'zod';

import { findToolCatalogEntry } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { notifyThreadUpdated } from '../threads/thread-events';
import { buildChatApplyExtra } from '../toolkit/extras';
import { errorMessage } from '../toolkit/result-text';
import {
  assertArgsValid,
  assertConfirmed,
  assertFresh,
  failedValues,
  readHandlerResult,
  StaleRefusal,
  staleValues,
  toChainRow,
  writeIfCurrent,
} from './approval-support';
import type { ApproveParams } from './approve';
import { cardConflict, cardFailure } from './card-conflict';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';
import { describeInputError } from './placeholders';
import { findRevisionMismatch } from './plan-chain';

type Claim =
  | { kind: 'claimed'; args: Record<string, unknown>; revision: number; toolName: string; threadId: string }
  | { kind: 'idempotent' }
  | { kind: 'conflict'; reason: 'revision' | 'notPending' | 'expired' | 'unavailable' };

/**
 * Standalone tools queue work or commit on their own, so the handler cannot join a transaction.
 * The claim is the transaction: it locks the card, runs every check an ordinary approval runs and
 * commits `applying`. Only a card that is `pending` can be claimed, so a claim is never repeated and
 * a card left in `applying` by a crash is never run again.
 */
const claim = withTransaction(async ({ params }: { params: ApproveParams }): Promise<Claim> => {
  const row = await findOwnedProposal({ userId: params.user.id, proposalId: params.proposalId, lock: true });
  if (row.status === 'applied') return { kind: 'idempotent' };
  if (isExpiryDue({ row })) {
    await expireDueCards({ ids: [row.id as string] });
    return { kind: 'conflict', reason: 'expired' };
  }
  if (row.status !== 'pending')
    return { kind: 'conflict', reason: row.status === 'expired' ? 'expired' : 'notPending' };

  const policy = resolveToolPolicy({ name: row.toolName, args: row.args });
  const entry = findToolCatalogEntry({ name: row.toolName });
  if (!policy || !entry || row.dependsOn.length > 0 || (policy.previewResolver !== null && row.preview === null)) {
    return { kind: 'conflict', reason: 'unavailable' };
  }

  const rows = new Map([[row.id as string, toChainRow({ row })]]);
  if (
    findRevisionMismatch({
      order: [row.id as string],
      rows,
      targetId: row.id as string,
      revision: params.revision,
      parentRevisions: {},
    }) !== null
  ) {
    return { kind: 'conflict', reason: 'revision' };
  }

  assertConfirmed({ rows: [row], confirmation: params.confirmation });
  assertArgsValid({ row, entry });
  await assertFresh({ row, policy, parentStatuses: [] });

  await ChatProposals.update(
    { status: 'applying', statusReason: null, decidedAt: new Date() },
    { where: { id: row.id as string, status: 'pending', revision: row.revision } },
  );

  const parsed = entry.inputShape === null ? row.args : z.object(entry.inputShape).parse(row.args);
  return {
    kind: 'claimed',
    args: parsed as Record<string, unknown>,
    revision: row.revision,
    toolName: row.toolName,
    threadId: row.threadId,
  };
});

/**
 * The approval of a standalone tool: claim, run the handler outside any transaction, then record
 * the outcome in a second one. A failure is recorded as `failed` and never retried.
 */
export async function approveStandalone(params: ApproveParams): Promise<ChatCardActionResponse> {
  const { user, proposalId } = params;
  const extra = await buildChatApplyExtra({ user });

  let outcome: Claim;
  try {
    outcome = await claim({ params });
  } catch (error) {
    if (error instanceof StaleRefusal) {
      await writeIfCurrent({
        writes: [{ id: error.row.id, revision: error.row.revision, values: staleValues({ refusal: error }) }],
      });
      throw await cardConflict({
        userId: user.id,
        targetId: proposalId,
        reason: 'stale',
        stale: { reasonKey: error.reasonKey, before: error.before, after: error.after },
      });
    }
    throw error;
  }

  if (outcome.kind === 'conflict')
    throw await cardConflict({ userId: user.id, targetId: proposalId, reason: outcome.reason });
  if (outcome.kind === 'idempotent') {
    const [card] = await loadCards({ userId: user.id, ids: [proposalId] });
    return { card: card!, cards: [card!] };
  }

  const policy = resolveToolPolicy({ name: outcome.toolName, args: outcome.args })!;
  const entry = findToolCatalogEntry({ name: outcome.toolName })!;

  try {
    const result = await runWithBalanceRevalueBatch(() => entry.invoke({ args: outcome.args, extra }));
    const { id, output } = readHandlerResult({ result, policy });
    const appliedAt = new Date();

    await writeIfCurrent({
      writes: [
        {
          id: proposalId,
          revision: outcome.revision,
          from: 'applying',
          values: {
            status: 'applied',
            executedArgs: outcome.args,
            result: { refs: id ? [{ kind: policy.entity, id }] : [], ...(output === undefined ? {} : { output }) },
            error: null,
            appliedAt,
            decidedAt: appliedAt,
          },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof z.ZodError ? describeInputError({ error }) : errorMessage({ error });
    await writeIfCurrent({
      writes: [{ id: proposalId, revision: outcome.revision, from: 'applying', values: failedValues({ message }) }],
    });
    throw await cardFailure({ userId: user.id, targetId: proposalId, message });
  }

  notifyThreadUpdated({ userId: user.id, threadId: outcome.threadId });
  const [card] = await loadCards({ userId: user.id, ids: [proposalId] });
  return { card: card!, cards: [card!] };
}
