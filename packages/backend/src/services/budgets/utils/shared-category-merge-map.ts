import type { RecordId } from '@bt/shared/types';

/** Buckets recipients' null-key (custom) categories; the non-UUID shape can't collide with a real `Categories.id`. */
export const OTHER_CATEGORY_ID = '__shared_budget_other__' as RecordId;

/**
 * Maps each contributor's category id onto the owner's tree by `Categories.key`:
 * owner categories map to themselves, a recipient's keyed category to the owner's
 * category with the same key (or itself when the owner has none), and a recipient's
 * null-key category to `OTHER_CATEGORY_ID`.
 */
export const buildSharedBudgetMergeMap = ({
  categories,
  ownerUserId,
}: {
  categories: { id: RecordId; key: string | null; userId: number }[];
  ownerUserId: number;
}): Map<RecordId, RecordId> => {
  const ownerKeyToId = new Map<string, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId && cat.key !== null) ownerKeyToId.set(cat.key, cat.id);
  }

  const mergeMap = new Map<RecordId, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId) mergeMap.set(cat.id, cat.id);
    else if (cat.key === null) mergeMap.set(cat.id, OTHER_CATEGORY_ID);
    else mergeMap.set(cat.id, ownerKeyToId.get(cat.key) ?? cat.id);
  }
  return mergeMap;
};
