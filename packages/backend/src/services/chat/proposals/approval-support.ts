import type { ChatProposalSnapshot, ChatProposalStatus } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import ChatProposals from '@models/chat-proposals.model';
import { withTransaction } from '@services/common/with-transaction';

import type { ToolCallResult, ToolCatalogEntry } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import type { ResolvedToolPolicy } from '../policies/rules';
import { errorMessage } from '../toolkit/result-text';
import { computeCardState, type CardState } from './card-state';
import { validateWithRefs } from './placeholders';
import { confirmationMatches, strictestRequirement, type ChainRow } from './plan-chain';
import { compareSnapshots } from './snapshot';

/** A card the snapshot check found stale; thrown inside the approval transaction so it rolls back. */
export class StaleRefusal extends Error {
  readonly row: { id: string; revision: number; snapshot: ChatProposalSnapshot | null };
  readonly reasonKey: string;
  readonly before: unknown;
  readonly after: unknown;

  constructor({
    row,
    reasonKey,
    before,
    after,
  }: {
    row: { id: string; revision: number; snapshot: ChatProposalSnapshot | null };
    reasonKey: string;
    before: unknown;
    after: unknown;
  }) {
    super(reasonKey);
    this.row = row;
    this.reasonKey = reasonKey;
    this.before = before;
    this.after = after;
  }
}

/** A handler (or the validation just before it) failed inside the approval transaction. */
export class ApplyFailure extends Error {
  /** The cards the approval was about to apply, with the revision it checked for each. */
  readonly rows: Array<{ id: string; revision: number }>;

  constructor({ message, rows }: { message: string; rows: Array<{ id: string; revision: number }> }) {
    super(message);
    this.rows = rows;
  }
}

/** What the planner and the confirmation check need from a stored card. */
export function toChainRow({ row }: { row: ChatProposals }): ChainRow {
  return {
    id: row.id as string,
    status: row.status,
    revision: row.revision,
    toolName: row.toolName,
    dependsOn: row.dependsOn,
    confirmation: row.confirmation,
    confirmationPhrase: row.confirmationPhrase,
    egressHost: resolveToolPolicy({ name: row.toolName, args: row.args })?.egress?.host ?? null,
  };
}

/** The request's confirmation against the strictest need of the cards; 422 when it does not fit. */
export function assertConfirmed({ rows, confirmation }: { rows: ChatProposals[]; confirmation: string | undefined }) {
  const requirement = strictestRequirement({ rows: rows.map((row) => toChainRow({ row })) });
  if (!confirmationMatches({ requirement, confirmation })) {
    throw new ValidationError({ message: t({ key: 'chat.confirmationRequired' }) });
  }
}

/** The tool's real schema and `validateArgs` on the stored arguments, refs standing in for ids not made yet; 422 on failure. */
export function assertArgsValid({ row, entry }: { row: ChatProposals; entry: ToolCatalogEntry }) {
  try {
    validateWithRefs({ entry, args: row.args });
  } catch (error) {
    throw new ValidationError({ message: errorMessage({ error }) });
  }
}

/**
 * Recomputes what the card was previewed against, holding the rows it reads, and compares it with
 * the stored snapshot. A
 * stale card throws `StaleRefusal`; a fresh one returns the state, whose snapshot holds the frozen
 * target ids of a bulk delete.
 */
export async function assertFresh({
  row,
  policy,
  parentStatuses,
}: {
  row: ChatProposals;
  policy: ResolvedToolPolicy;
  parentStatuses: Array<{ id: string; status: ChatProposalStatus }>;
}): Promise<CardState> {
  const identity = { id: row.id as string, revision: row.revision, snapshot: row.snapshot };
  // Locked: the rows stay held until the transaction ends, so the handler writes what was just checked.
  const state = await computeCardState({
    userId: row.userId,
    policy,
    args: row.args,
    parents: parentStatuses,
    lock: true,
  });

  if (policy.previewResolver && state.error) {
    throw new StaleRefusal({
      row: identity,
      reasonKey: state.error.messageKey ?? 'chat.cards.previewFailed',
      before: null,
      after: state.error.message ?? null,
    });
  }

  const comparison = compareSnapshots({ stored: row.snapshot ?? { baseCurrencyCode: '' }, current: state.snapshot });
  if (comparison.stale) {
    throw new StaleRefusal({
      row: identity,
      reasonKey: comparison.reasonKey,
      before: comparison.before,
      after: comparison.after,
    });
  }

  return state;
}

/** The text the handler answered with, as one string. */
const resultText = ({ result }: { result: ToolCallResult }) => result.content.map((block) => block.text).join('\n');

const valueAtPath = ({ value, path }: { value: unknown; path: string }): unknown =>
  path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, value);

const SLIM_OUTPUT_MAX_CHARS = 4_000;

/** The id a create call made (at the policy's path) and the handler output when it is small enough to keep. */
export function readHandlerResult({ result, policy }: { result: ToolCallResult; policy: ResolvedToolPolicy }) {
  const text = resultText({ result });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  const id = valueAtPath({ value: parsed, path: policy.resultIdPath });
  return {
    id: typeof id === 'string' ? id : null,
    output: parsed !== undefined && text.length <= SLIM_OUTPUT_MAX_CHARS ? parsed : undefined,
  };
}

/**
 * Status writes that follow a rollback or a committed claim. Each is conditional on the card still
 * being in the state and revision the attempt saw, so an obsolete attempt never marks a card that
 * was edited, refreshed or decided meanwhile. Runs as one short transaction.
 */
export const writeIfCurrent = withTransaction(
  async ({
    writes,
  }: {
    writes: Array<{
      id: string;
      revision: number;
      /** The status the row must still have; `pending` for the writes after a rollback. */
      from?: ChatProposalStatus;
      values: Record<string, unknown>;
    }>;
  }) => {
    for (const write of writes) {
      await ChatProposals.update(write.values, {
        where: { id: write.id, status: write.from ?? 'pending', revision: write.revision },
      });
    }
  },
);

export const failedValues = ({ message }: { message: string }) => ({
  status: 'failed' as const,
  statusReason: 'applyFailed',
  error: { message: message || t({ key: 'chat.cardApplyFailed' }) },
  decidedAt: new Date(),
});

export const staleValues = ({ refusal }: { refusal: StaleRefusal }) => ({
  status: 'stale' as const,
  statusReason: refusal.reasonKey,
  snapshot: {
    ...(refusal.row.snapshot ?? { baseCurrencyCode: '' }),
    staleDiff: { before: refusal.before, after: refusal.after },
  },
});
