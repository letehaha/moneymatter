import { buildCategoriesObjectGraph, findFormattedCategoryById } from '@/stores/categories/helpers';
import { type CategoryModel, type RecordId } from '@bt/shared/types';

import { categoryDropError } from './can-drop-category';

/** `siblingIds` with `draggedId` moved next to `targetId`, or `null` when the target isn't among them. */
export const reorderSiblingIds = ({
  siblingIds,
  draggedId,
  targetId,
  position,
}: {
  siblingIds: RecordId[];
  draggedId: RecordId;
  targetId: RecordId;
  position: 'before' | 'after';
}): RecordId[] | null => {
  const ids = siblingIds.filter((id) => id !== draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex === -1) return null;

  ids.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedId);
  return ids;
};

export interface PendingCategoryMove {
  categoryId: RecordId;
  parentId: RecordId | null;
}

/**
 * Net view of the queue: later moves of the same category replace earlier ones, and a
 * category that ended up back at its original parent, or no longer exists, drops out
 * entirely. The raw queue stays untouched for the API replay; this only drives what the
 * user sees as pending.
 */
export const netMoves = ({
  moves,
  categories,
}: {
  moves: PendingCategoryMove[];
  categories: CategoryModel[];
}): PendingCategoryMove[] => {
  const lastByCategory = new Map<RecordId, PendingCategoryMove>();
  for (const move of moves) lastByCategory.set(move.categoryId, move);

  const originalParentById = new Map(categories.map((category) => [category.id, category.parentId]));

  return [...lastByCategory.values()].filter(
    (move) => originalParentById.has(move.categoryId) && originalParentById.get(move.categoryId) !== move.parentId,
  );
};

/**
 * Skips moves whose category or target no longer resolves: an unresolvable parentId
 * would leave an orphaned node that crashes the tree build.
 */
export const applyPendingMoves = ({
  categories,
  moves,
}: {
  categories: CategoryModel[];
  moves: PendingCategoryMove[];
}): CategoryModel[] => {
  if (!moves.length) return categories;

  const ids = new Set(categories.map((category) => category.id));
  const nextParentById = new Map<RecordId, RecordId | null>();
  for (const move of moves) {
    if (ids.has(move.categoryId) && (move.parentId === null || ids.has(move.parentId))) {
      nextParentById.set(move.categoryId, move.parentId);
    }
  }

  return categories.map((category) =>
    nextParentById.has(category.id) ? { ...category, parentId: nextParentById.get(category.id) ?? null } : category,
  );
};

const depthOf = ({ categories, categoryId }: { categories: CategoryModel[]; categoryId: RecordId }): number => {
  const parentById = new Map(categories.map((category) => [category.id, category.parentId]));
  const visited = new Set<RecordId>([categoryId]);
  let depth = 1;
  let parentId = parentById.get(categoryId) ?? null;

  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = parentById.get(parentId) ?? null;
  }

  return depth;
};

/**
 * Returns the subsequence of the raw queue that still replays cleanly after something
 * changed under it (an unqueued entry, a deleted category). Each move was validated
 * against the tree its predecessors produced, so removing one entry can leave survivors
 * that cycle, orphan, or break the depth limit.
 */
export const sanitizeMoves = ({
  categories,
  moves,
  maxNesting,
}: {
  categories: CategoryModel[];
  moves: PendingCategoryMove[];
  maxNesting: number;
}): PendingCategoryMove[] => {
  const ids = new Set(categories.map((category) => category.id));
  const accepted: PendingCategoryMove[] = [];

  for (const move of moves) {
    if (!ids.has(move.categoryId)) continue;
    if (move.parentId !== null && !ids.has(move.parentId)) continue;

    const current = applyPendingMoves({ categories, moves: accepted });
    const tree = buildCategoriesObjectGraph({ items: current });
    const dragged = findFormattedCategoryById(tree, move.categoryId);
    if (!dragged) continue;

    let error: ReturnType<typeof categoryDropError>;
    if (move.parentId === null) {
      error = categoryDropError({ dragged, target: null, maxNesting });
    } else {
      const target = findFormattedCategoryById(tree, move.parentId);
      if (!target) continue;
      error = categoryDropError({
        dragged,
        target,
        targetDepth: depthOf({ categories: current, categoryId: target.id }),
        maxNesting,
      });
    }

    if (error === null) accepted.push(move);
  }

  return accepted;
};
