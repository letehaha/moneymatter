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
  let parentId = categoriesMap[id]?.parentId;
  while (parentId && parentId !== stopId) {
    const parent = categoriesMap[parentId];
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
};

export const collectSubtreeIds = ({ rootId, categories }: { rootId: string; categories: CategoryNode[] }): string[] => {
  const result = [rootId];
  for (let i = 0; i < result.length; i++) {
    for (const category of categories) {
      if (category.parentId === result[i]) result.push(category.id);
    }
  }
  return result;
};

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
