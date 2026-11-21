export interface CategoryNode {
  id: string;
  parentId: string | null;
}

export const hasChildren = ({ id, categories }: { id: string | undefined; categories: CategoryNode[] }): boolean =>
  id !== undefined && categories.some((category) => category.parentId === id);

/** Ancestors of `id`, root first, stopping below `stopId` when given. */
export const getAncestors = <T extends CategoryNode>({
  id,
  categoriesMap,
  stopId,
}: {
  id: string;
  categoriesMap: Record<string, T>;
  stopId?: string;
}): T[] => {
  const chain: T[] = [];
  const seen = new Set([id]);
  let parentId = categoriesMap[id]?.parentId;
  while (parentId && parentId !== stopId && !seen.has(parentId)) {
    const parent = categoriesMap[parentId];
    if (!parent) break;
    seen.add(parentId);
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
};

/** `rootId` and its descendants; an excluded category is skipped along with its whole subtree. */
export const collectSubtreeIds = ({
  rootId,
  categories,
  excludedIds = [],
}: {
  rootId: string;
  categories: CategoryNode[];
  excludedIds?: string[];
}): string[] => {
  const result = [rootId];
  const skip = new Set([rootId, ...excludedIds]);
  for (let i = 0; i < result.length; i++) {
    for (const category of categories) {
      if (category.parentId === result[i] && !skip.has(category.id)) {
        skip.add(category.id);
        result.push(category.id);
      }
    }
  }
  return result;
};

/**
 * Stats endpoints roll each amount up to its nearest selected ancestor, so sending a scope
 * category together with its direct children returns exactly one level, with the scope
 * itself holding what is booked on it directly.
 */
export const getLevelCategoryIds = ({
  scopeId,
  categories,
  excludedIds = [],
}: {
  scopeId: string;
  categories: CategoryNode[];
  excludedIds?: string[];
}): string[] => [
  scopeId,
  ...categories
    .filter((category) => category.parentId === scopeId && !excludedIds.includes(category.id))
    .map((category) => category.id),
];

/**
 * A row that holds only what is booked on a parent directly, beside rows for its children:
 * in detail mode any parent, otherwise the scope category when it has subcategories.
 */
export const isRemainderRow = ({
  id,
  scopeId,
  detail,
  categories,
}: {
  id: string;
  scopeId: string | undefined;
  detail: boolean;
  categories: CategoryNode[];
}): boolean => (detail || id === scopeId) && hasChildren({ id, categories });
