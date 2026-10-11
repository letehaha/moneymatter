/**
 * Walks parentId links from a category up to its root, returning the root category id.
 *
 * The walk stops early — returning the deepest resolvable ancestor — when a parentId points at
 * a category missing from the map, so a dangling parent link can never yield an undefined walk.
 * A categoryId that is not in the map at all resolves to itself.
 */
export const getRootCategoryId = <T extends { id: string; parentId: string | null }>({
  categoryId,
  byId,
}: {
  categoryId: string;
  byId: Map<string, T>;
}): string => {
  let current = byId.get(categoryId);
  if (!current) return categoryId;

  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }

  return current.id;
};

/**
 * Ancestor ids of a category, nearest first, excluding the category itself. The walk stops
 * at a dangling parent link, and a visited guard terminates it even when corrupt data
 * contains a parent cycle.
 */
export const getAncestorIds = <T extends { id: string; parentId: string | null }>({
  categoryId,
  byId,
}: {
  categoryId: string;
  byId: Map<string, T>;
}): string[] => {
  const ancestors: string[] = [];
  const visited = new Set<string>([categoryId]);
  let current = byId.get(categoryId);

  while (current && current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent || visited.has(parent.id)) break;
    ancestors.push(parent.id);
    visited.add(parent.id);
    current = parent;
  }

  return ancestors;
};

/** Categories handed out one by one; a category overlaps when it, an ancestor or a descendant is already taken. */
export const createCategoryClaims = <T extends { id: string; parentId: string | null }>({
  byId,
}: {
  byId: Map<string, T>;
}) => {
  const taken = new Set<string>();
  const takenAncestors = new Set<string>();

  return {
    take: ({ categoryId }: { categoryId: string }) => {
      taken.add(categoryId);
      for (const ancestorId of getAncestorIds({ categoryId, byId })) takenAncestors.add(ancestorId);
    },
    overlaps: ({ categoryId }: { categoryId: string }) =>
      taken.has(categoryId) ||
      takenAncestors.has(categoryId) ||
      getAncestorIds({ categoryId, byId }).some((ancestorId) => taken.has(ancestorId)),
  };
};

/**
 * A memoized `getRootCategoryId` bound to one category map. Stats aggregations resolve the same
 * category's root many times per request; the cache turns each repeat into an O(1) lookup.
 */
export const createRootCategoryResolver = <T extends { id: string; parentId: string | null }>({
  byId,
}: {
  byId: Map<string, T>;
}): ((categoryId: string) => string) => {
  const cache = new Map<string, string>();
  return (categoryId: string): string => {
    const cached = cache.get(categoryId);
    if (cached !== undefined) return cached;
    const rootId = getRootCategoryId({ categoryId, byId });
    cache.set(categoryId, rootId);
    return rootId;
  };
};

/**
 * Expands a set of selected category ids to also include every descendant, so selecting a parent
 * category matches transactions filed directly under any of its subcategories. Each category is
 * kept when itself or any ancestor is in the selected set. The originally selected ids are always
 * present in the result.
 */
export const expandCategoryIdsWithDescendants = <T extends { id: string; parentId: string | null }>({
  categoryIds,
  categories,
  byId,
}: {
  categoryIds: string[];
  categories: T[];
  byId: Map<string, T>;
}): string[] => {
  const expanded = new Set<string>(categoryIds);

  for (const cat of categories) {
    let current: T | undefined = byId.get(cat.id);
    while (current) {
      if (categoryIds.includes(current.id)) {
        expanded.add(cat.id);
        break;
      }
      if (current.parentId === null) break;
      current = byId.get(current.parentId);
    }
  }

  return [...expanded];
};
