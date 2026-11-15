import ChatProposals from '@models/chat-proposals.model';

import { getToolPolicy } from '../policies';
import type { ResolvedToolPolicy } from '../policies/rules';
import { assertNoRefCycle, ToolInputError } from './placeholders';

export const loadParentRows = ({
  ids,
  userId,
  threadId,
}: {
  ids: string[];
  userId: number;
  threadId: string;
}): Promise<ChatProposals[]> =>
  ids.length === 0 ? Promise.resolve([]) : ChatProposals.findAll({ where: { id: ids, userId, threadId } });

/**
 * The cards a proposal refers to must exist, belong to this user and thread, and still be
 * pending; a standalone tool takes part in no chain; and the refs may not loop back. Used when a
 * card is made and again when it is edited. A card being edited may keep a ref to a parent that was
 * applied on its own since (`appliedParents`): the approval swaps that ref for the id the parent made.
 */
export async function resolveParents({
  userId,
  threadId,
  proposalId,
  refs,
  policy,
  appliedParents = [],
}: {
  userId: number;
  threadId: string;
  proposalId: string;
  refs: string[];
  policy: ResolvedToolPolicy;
  /** Refs the card already held, which may now point at an applied card. */
  appliedParents?: readonly string[];
}): Promise<ChatProposals[]> {
  if (refs.length === 0) return [];
  if (policy.standalone) {
    throw new ToolInputError(`${policy.name} runs on its own and cannot refer to other proposals with $proposal: refs`);
  }

  const parents = await loadParentRows({ ids: refs, userId, threadId });
  const byId = new Map(parents.map((parent) => [parent.id as string, parent]));

  for (const id of refs) {
    const parent = byId.get(id);
    if (!parent) {
      throw new ToolInputError(
        `Unknown proposal $proposal:${id}. Refer only to proposals you made in this conversation, with the ref a propose call returned.`,
      );
    }
    if (parent.status !== 'pending' && !(parent.status === 'applied' && appliedParents.includes(id))) {
      throw new ToolInputError(
        `Proposal $proposal:${id} is ${parent.status}, so it cannot be referred to. Use the real id of the ${parent.entity}, or propose it again.`,
      );
    }
    if (getToolPolicy({ name: parent.toolName })?.standalone) {
      throw new ToolInputError(
        `Proposal $proposal:${id} (${parent.toolName}) runs on its own and cannot be referred to`,
      );
    }
  }

  assertNoRefCycle({
    proposalId,
    refs,
    dependsOnById: new Map(parents.map((parent) => [parent.id as string, parent.dependsOn])),
  });
  return parents;
}
