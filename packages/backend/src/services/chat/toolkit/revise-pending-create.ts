import ChatProposals from '@models/chat-proposals.model';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';
import { findProposalRefs, isProposalRef } from '../proposals/placeholders';
import { CHAT_META_FIELD } from './model-schema';

const UPDATE_TRANSACTION = 'update_transaction';
const CREATE_TRANSACTION = 'create_transaction';

/**
 * `update_transaction` clears a field with `null` (or an empty list); `create_transaction` has no
 * such value, so a cleared field is left out of the revised create.
 */
const isCleared = ({ value }: { value: unknown }) => value === null || (Array.isArray(value) && value.length === 0);

/**
 * The create arguments after an edit that was written as an update: what the create held, with every
 * field the update names laid over it. `id` is the target, not a field. A payee id and a merchant
 * name cannot be combined, so whichever the edit gives replaces the other.
 */
export function mergeUpdateIntoCreate({
  createArgs,
  updateArgs,
}: {
  createArgs: Record<string, unknown>;
  updateArgs: Record<string, unknown>;
}): Record<string, unknown> {
  const { id: _target, ...changes } = updateArgs;
  const merged: Record<string, unknown> = { ...createArgs };

  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;

    if (isCleared({ value })) delete merged[field];
    else merged[field] = value;
  }

  if (changes.payeeId != null) delete merged.merchantName;

  return merged;
}

/**
 * An edit of a transaction that a pending card has yet to create is an edit of that card, not an
 * update of a record that does not exist: the update's target is a `$proposal:` ref, so the card it
 * would produce can neither be previewed nor approved, and it would take the create's place. Turns
 * such a call into the create with the new values that replaces the pending one. Returns `null` for
 * any other call, which goes its own way.
 */
export async function reviseOfPendingCreate({
  userId,
  threadId,
  entry,
  catalog,
  input,
}: {
  userId: number;
  threadId: string;
  entry: ToolCatalogEntry;
  catalog: readonly ToolCatalogEntry[];
  input: unknown;
}): Promise<{ entry: ToolCatalogEntry; input: Record<string, unknown> } | null> {
  if (entry.name !== UPDATE_TRANSACTION || input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const { [CHAT_META_FIELD]: meta, ...args } = input as Record<string, unknown>;
  if (!isProposalRef({ value: args.id })) return null;

  const [targetId] = findProposalRefs({ value: args.id });
  const target = await ChatProposals.findOne({ where: { id: targetId, userId, threadId, status: 'pending' } });
  const create = catalog.find((candidate) => candidate.name === CREATE_TRANSACTION);
  if (target?.toolName !== CREATE_TRANSACTION || !create) return null;

  return {
    entry: create,
    input: {
      ...mergeUpdateIntoCreate({ createArgs: target.args, updateArgs: args }),
      [CHAT_META_FIELD]: { ...(meta as Record<string, unknown> | undefined), replaces: target.id },
    },
  };
}
