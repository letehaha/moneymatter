import type { ChatCardActionResponse, ChatProposalCard, ChatProposalResult } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import ChatProposals from '@models/chat-proposals.model';
import type Users from '@models/users.model';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { withTransaction } from '@services/common/with-transaction';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { findToolCatalogEntry } from '../../mcp/tool-catalog';
import { getToolPolicy, resolveToolPolicy } from '../policies';
import { notifyThreadUpdated } from '../threads/thread-events';
import { buildChatApplyExtra } from '../toolkit/extras';
import { errorMessage } from '../toolkit/result-text';
import {
  ApplyFailure,
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
import { approveStandalone } from './approve-standalone';
import { cardConflict, cardFailure } from './card-conflict';
import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';
import { describeInputError, substituteRefs } from './placeholders';
import { findRevisionMismatch, planChain } from './plan-chain';

type ApprovalUser = Pick<Users, 'id' | 'username' | 'authUserId' | 'role'>;

export interface ApproveParams {
  user: ApprovalUser;
  proposalId: string;
  revision: number;
  parentRevisions: Record<string, number>;
  confirmation: string | undefined;
}

type ChainAttempt =
  | { kind: 'applied'; chainIds: string[] }
  | { kind: 'idempotent'; chainIds: string[] }
  | { kind: 'conflict'; reason: 'revision' | 'notPending' | 'blocked' | 'expired' | 'unavailable'; chainIds: string[] };

/** The cards a row's approval needs next: its parents, except that an applied parent is done (the target itself is looked at anyway). */
const parentsToFollow = ({ row, targetId }: { row: ChatProposals; targetId: string }) =>
  row.status === 'applied' && row.id !== targetId ? [] : row.dependsOn;

/** The ids of the target and of every card it depends on, found level by level without locking anything. */
async function findChainIds({ userId, targetId }: { userId: number; targetId: string }): Promise<Set<string>> {
  const known = new Set([targetId]);
  let wanted = [targetId];

  while (wanted.length > 0) {
    const rows = await ChatProposals.findAll({
      where: { id: wanted, userId },
      attributes: ['id', 'status', 'dependsOn'],
    });
    wanted = [...new Set(rows.flatMap((row) => parentsToFollow({ row, targetId })))].filter((id) => !known.has(id));
    for (const id of wanted) known.add(id);
  }

  return known;
}

/**
 * Locks the target and every card it depends on with one query, in ascending id order. Every
 * approval takes its locks in that one global order, so two approvals whose chains overlap queue up
 * instead of waiting on each other. The chain was found without locks, so the locked rows are read
 * again: a card edited meanwhile may depend on one more, which is then locked as well (the whole set
 * again, in order).
 */
async function lockChain({ userId, targetId }: { userId: number; targetId: string }) {
  const ids = await findChainIds({ userId, targetId });

  for (;;) {
    const rows = await ChatProposals.findAll({
      where: { id: [...ids].toSorted(), userId },
      order: [['id', 'ASC']],
      lock: true,
    });
    const missing = rows.flatMap((row) => parentsToFollow({ row, targetId })).filter((id) => !ids.has(id));
    if (missing.length === 0) return new Map(rows.map((row) => [row.id as string, row]));

    for (const id of missing) ids.add(id);
  }
}

const CONFLICT_REASON_OF_STATUS = ({ status }: { status: ChatProposals['status'] }) =>
  status === 'expired' ? ('expired' as const) : ('notPending' as const);

/**
 * The approval of a chain of normal tools, as one transaction: the lock, the checks, every handler
 * and the `applied` statuses commit together or not at all. A refusal that must leave no trace
 * (stale, a handler error) is thrown so the transaction rolls back; the status it deserves is
 * written afterwards by the caller, conditional on the revision it checked.
 */
const applyChain = withTransaction(
  async ({
    params,
    extra,
  }: {
    params: ApproveParams;
    extra: Awaited<ReturnType<typeof buildChatApplyExtra>>;
  }): Promise<ChainAttempt> => {
    const { user, proposalId } = params;
    const rows = await lockChain({ userId: user.id, targetId: proposalId });
    const target = rows.get(proposalId);
    if (!target) throw new NotFoundError({ message: t({ key: 'chat.proposalNotFound' }) });

    const chainRows = new Map([...rows].map(([id, row]) => [id, toChainRow({ row })]));
    const knownIds = [...rows.keys()];
    if (target.status === 'applied') return { kind: 'idempotent', chainIds: knownIds };

    const plan = planChain({
      targetId: proposalId,
      rows: chainRows,
      isStandalone: ({ toolName }) => getToolPolicy({ name: toolName })?.standalone === true,
    });
    if (!plan.ok) {
      if (plan.reason === 'notPending' && plan.proposalId === proposalId) {
        return { kind: 'conflict', reason: CONFLICT_REASON_OF_STATUS({ status: target.status }), chainIds: knownIds };
      }
      return {
        kind: 'conflict',
        reason: plan.reason === 'standalone' || plan.reason === 'cycle' ? 'unavailable' : 'blocked',
        chainIds: knownIds,
      };
    }

    const order = plan.order.map((id) => rows.get(id)!);
    const due = order.filter((row) => isExpiryDue({ row })).map((row) => row.id as string);
    if (due.length > 0) {
      await expireDueCards({ ids: due });
      return { kind: 'conflict', reason: 'expired', chainIds: knownIds };
    }

    const prepared = order.map((row) => ({
      row,
      policy: resolveToolPolicy({ name: row.toolName, args: row.args }),
      entry: findToolCatalogEntry({ name: row.toolName }),
    }));
    const realIds = new Map<string, string>();
    for (const id of plan.appliedParents) {
      const realId = rows.get(id)!.result?.refs[0]?.id;
      if (realId) realIds.set(id, realId);
    }
    const unavailable =
      prepared.some(
        ({ row, policy, entry }) => !policy || !entry || (policy.previewResolver !== null && row.preview === null),
      ) || plan.appliedParents.some((id) => !realIds.has(id));
    if (unavailable) return { kind: 'conflict', reason: 'unavailable', chainIds: knownIds };

    if (
      findRevisionMismatch({
        order: plan.order,
        rows: chainRows,
        targetId: proposalId,
        revision: params.revision,
        parentRevisions: params.parentRevisions,
      }) !== null
    ) {
      return { kind: 'conflict', reason: 'revision', chainIds: knownIds };
    }

    assertConfirmed({ rows: order, confirmation: params.confirmation });
    for (const { row, entry } of prepared) assertArgsValid({ row, entry: entry! });

    const states = new Map<string, Awaited<ReturnType<typeof assertFresh>>>();
    for (const { row, policy } of prepared) {
      states.set(
        row.id as string,
        await assertFresh({
          row,
          policy: policy!,
          parentStatuses: row.dependsOn.flatMap((id) => (rows.has(id) ? [{ id, status: rows.get(id)!.status }] : [])),
        }),
      );
    }

    const needed = new Set<string>(order.flatMap((row) => row.dependsOn));
    const checked = order.map((row) => ({ id: row.id as string, revision: row.revision }));
    const applied = new Map<string, { executedArgs: Record<string, unknown>; result: ChatProposalResult }>();

    for (const { row, policy, entry } of prepared) {
      try {
        let args = substituteRefs({ value: row.args, ids: realIds }) as Record<string, unknown>;
        const frozen = states.get(row.id as string)!.snapshot.targetIds;
        // The ids the user confirmed, not a filter a later commit could widen.
        if (policy!.previewResolver === 'bulkDeleteTransactions' && frozen) args = { transactionIds: frozen };

        const parsed = entry!.inputShape === null ? args : z.object(entry!.inputShape).parse(args);
        entry!.validateArgs({ args: parsed });

        const { id, output } = readHandlerResult({
          result: await entry!.invoke({ args: parsed, extra }),
          policy: policy!,
        });
        if (needed.has(row.id as string)) {
          if (!id) throw new Error(`${row.toolName} did not return the id that a later change refers to`);
          realIds.set(row.id as string, id);
        }

        applied.set(row.id as string, {
          executedArgs: parsed as Record<string, unknown>,
          result: { refs: id ? [{ kind: policy!.entity, id }] : [], ...(output === undefined ? {} : { output }) },
        });
      } catch (error) {
        const message = error instanceof z.ZodError ? describeInputError({ error }) : errorMessage({ error });
        throw new ApplyFailure({ message, rows: checked });
      }
    }

    const chainId = randomUUID();
    const appliedAt = new Date();
    const parentIds = plan.order.filter((id) => id !== proposalId);
    for (const { row } of prepared) {
      const entryResult = applied.get(row.id as string)!;
      await ChatProposals.update(
        {
          status: 'applied',
          statusReason: null,
          executedArgs: entryResult.executedArgs,
          result: row.id === proposalId ? { ...entryResult.result, alsoApplied: parentIds } : entryResult.result,
          error: null,
          chainId,
          decidedAt: appliedAt,
          appliedAt,
        },
        { where: { id: row.id as string } },
      );
    }

    return { kind: 'applied', chainIds: knownIds };
  },
);

const toResponse = ({ cards, targetId }: { cards: ChatProposalCard[]; targetId: string }): ChatCardActionResponse => ({
  card: cards.find((card) => card.id === targetId)!,
  cards,
});

/**
 * Applies a card, and first its pending parents, with the user's own authority: the handler of each
 * tool runs exactly as it would through MCP, with a full-scope context. Everything the user could
 * have seen change since the card was made is checked first (revision, confirmation, arguments,
 * snapshot). See "Approval transaction" in the plan.
 */
export async function approveProposal({
  user,
  proposalId,
  revision,
  parentRevisions = {},
  confirmation,
}: Omit<ApproveParams, 'parentRevisions' | 'confirmation'> & {
  parentRevisions?: Record<string, number>;
  confirmation?: string;
}): Promise<ChatCardActionResponse> {
  const target = await findOwnedProposal({ userId: user.id, proposalId });
  const policy = getToolPolicy({ name: target.toolName });
  if (!policy) throw await cardConflict({ userId: user.id, targetId: proposalId, reason: 'unavailable' });

  const params: ApproveParams = { user, proposalId, revision, parentRevisions, confirmation };
  if (policy.standalone) return approveStandalone(params);

  const extra = await buildChatApplyExtra({ user });
  let attempt: ChainAttempt;
  try {
    attempt = await runWithBalanceRevalueBatch(() => applyChain({ params, extra }));
  } catch (error) {
    if (error instanceof StaleRefusal) {
      await writeIfCurrent({
        writes: [{ id: error.row.id, revision: error.row.revision, values: staleValues({ refusal: error }) }],
      });
      throw await cardConflict({
        userId: user.id,
        targetId: proposalId,
        chainIds: [error.row.id],
        reason: 'stale',
        stale: { reasonKey: error.reasonKey, before: error.before, after: error.after },
      });
    }
    if (error instanceof ApplyFailure) {
      await writeIfCurrent({
        writes: error.rows.map((row) => ({ ...row, values: failedValues({ message: error.message }) })),
      });
      throw await cardFailure({
        userId: user.id,
        targetId: proposalId,
        chainIds: error.rows.map((row) => row.id),
        message: error.message,
      });
    }
    throw error;
  }

  if (attempt.kind === 'conflict') {
    throw await cardConflict({
      userId: user.id,
      targetId: proposalId,
      chainIds: attempt.chainIds,
      reason: attempt.reason,
    });
  }

  if (attempt.kind === 'applied') notifyThreadUpdated({ userId: user.id, threadId: target.threadId });
  return toResponse({
    cards: await loadCards({ userId: user.id, ids: [proposalId, ...attempt.chainIds] }),
    targetId: proposalId,
  });
}
