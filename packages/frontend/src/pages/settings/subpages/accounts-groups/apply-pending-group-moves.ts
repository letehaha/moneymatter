import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';

import { flattenGroups } from './build-account-group-list';
import { groupDropError } from './can-drop-group';

export interface PendingGroupMove {
  groupId: string;
  parentGroupId: string | null;
}

/**
 * Net view of the queue: the last move per group wins and keeps the position of that last
 * occurrence; a group that ends at its original parent, or whose group or target no longer exists, drops out.
 */
export const netMoves = ({
  moves,
  groups,
}: {
  moves: PendingGroupMove[];
  groups: AccountGroups[];
}): PendingGroupMove[] => {
  const lastByGroup = new Map<string, PendingGroupMove>();
  for (const move of moves) {
    lastByGroup.delete(move.groupId);
    lastByGroup.set(move.groupId, move);
  }

  const originalParentById = new Map(flattenGroups({ groups }).map((group) => [group.id, group.parentGroupId]));

  return [...lastByGroup.values()].filter(
    (move) =>
      originalParentById.has(move.groupId) &&
      (move.parentGroupId === null || originalParentById.has(move.parentGroupId)) &&
      originalParentById.get(move.groupId) !== move.parentGroupId,
  );
};

/**
 * Net moves are reordered relative to the raw queue, so a move can transiently form a cycle
 * until a later one lands. Failed moves are retried until a pass makes no progress.
 */
export const replayMoves = async ({
  moves,
  apply,
}: {
  moves: PendingGroupMove[];
  apply: (params: { move: PendingGroupMove }) => Promise<unknown>;
}): Promise<{ remaining: PendingGroupMove[]; lastError: unknown }> => {
  let remaining = moves;
  let lastError: unknown;

  while (remaining.length) {
    const failed: PendingGroupMove[] = [];
    lastError = undefined;
    for (const move of remaining) {
      try {
        await apply({ move });
      } catch (error) {
        failed.push(move);
        lastError = error;
      }
    }
    if (failed.length === remaining.length) break;
    remaining = failed;
  }

  return { remaining, lastError };
};

/** Rebuilds the tree with the moves applied. Moves whose group or target no longer resolves are skipped. */
export const applyPendingMoves = ({
  groups,
  moves,
}: {
  groups: AccountGroups[];
  moves: PendingGroupMove[];
}): AccountGroups[] => {
  if (!moves.length) return groups;

  const flat = flattenGroups({ groups });
  const ids = new Set(flat.map((group) => group.id));
  const nextParentById = new Map<string, string | null>();
  for (const move of moves) {
    if (ids.has(move.groupId) && (move.parentGroupId === null || ids.has(move.parentGroupId))) {
      nextParentById.set(move.groupId, move.parentGroupId);
    }
  }

  return buildAccountGroupTree({
    groups: flat.map((group) =>
      nextParentById.has(group.id) ? { ...group, parentGroupId: nextParentById.get(group.id) ?? null } : group,
    ),
  });
};

/**
 * Keeps the subsequence of the queue that still replays cleanly against a fresh tree.
 * Each move was validated against the tree its predecessors produced, so a refetch can
 * leave survivors that target a deleted group or would form a cycle.
 */
export const sanitizeMoves = ({
  groups,
  moves,
}: {
  groups: AccountGroups[];
  moves: PendingGroupMove[];
}): PendingGroupMove[] => {
  const accepted: PendingGroupMove[] = [];

  for (const move of moves) {
    const flat = flattenGroups({
      groups: applyPendingMoves({ groups, moves: accepted }),
    });
    const dragged = flat.find((group) => group.id === move.groupId);
    const target = move.parentGroupId === null ? null : flat.find((group) => group.id === move.parentGroupId);
    if (!dragged || target === undefined) continue;

    if (groupDropError({ dragged, target }) === null) accepted.push(move);
  }

  return accepted;
};
