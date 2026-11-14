import type { RecordId } from '@bt/shared/types';

/** Buckets recipients' null-key (custom) categories; the non-UUID shape can't collide with a real `Categories.id`. */
export const OTHER_CATEGORY_ID = '__shared_tracker_other__' as RecordId;

/**
 * Maps each contributor's category id onto the owner's tree by parent key + `Categories.key`:
 * owner categories map to themselves, a recipient's keyed category to the owner's
 * category with the same parent key and key (or itself when the owner has none), and a recipient's
 * null-key category to `OTHER_CATEGORY_ID`.
 */
export const buildSharedTrackerMergeMap = ({
  categories,
  ownerUserId,
}: {
  categories: { id: RecordId; key: string | null; parentId: RecordId | null; userId: number }[];
  ownerUserId: number;
}): Map<RecordId, RecordId> => {
  const idToKey = new Map(categories.map((cat) => [cat.id, cat.key]));
  const scopedKey = (cat: { key: string | null; parentId: RecordId | null }) =>
    `${(cat.parentId && idToKey.get(cat.parentId)) ?? ''}/${cat.key}`;

  const ownerKeyToId = new Map<string, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId && cat.key !== null) ownerKeyToId.set(scopedKey(cat), cat.id);
  }

  const mergeMap = new Map<RecordId, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId) mergeMap.set(cat.id, cat.id);
    else if (cat.key === null) mergeMap.set(cat.id, OTHER_CATEGORY_ID);
    else mergeMap.set(cat.id, ownerKeyToId.get(scopedKey(cat)) ?? cat.id);
  }
  return mergeMap;
};
