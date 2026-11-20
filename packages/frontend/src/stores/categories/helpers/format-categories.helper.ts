import { type FormattedCategory } from '@/common/types';
import { CATEGORY_ORDER_ROOT_KEY, CATEGORY_TYPES, type CategoryModel, type CategoryOrder } from '@bt/shared/types';

/** Listed ids first in list order, unlisted ones after them alphabetically, internal categories last. */
const sortSiblings = ({ nodes, orderedIds = [] }: { nodes: FormattedCategory[]; orderedIds?: string[] }) => {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const isInternal = (category: FormattedCategory) => Number(category.type === CATEGORY_TYPES.internal);

  return nodes.sort((a, b) => {
    const rankA = rank.get(a.id) ?? Infinity;
    const rankB = rank.get(b.id) ?? Infinity;
    return isInternal(a) - isInternal(b) || (rankA === rankB ? a.name.localeCompare(b.name) : rankA - rankB);
  });
};

/**
 * Walks the tree built by `buildCategoriesObjectGraph` and returns the node
 * whose id matches. A plain `Array.find()` over the top-level array only sees
 * roots — subcategories live under each root's `subCategories`, so a flat find
 * silently misses them.
 */
export const findFormattedCategoryById = (categories: FormattedCategory[], id: string): FormattedCategory | null => {
  for (const cat of categories) {
    if (cat.id === id) return cat;
    const found = findFormattedCategoryById(cat.subCategories ?? [], id);
    if (found) return found;
  }
  return null;
};

export const buildCategoriesObjectGraph = ({
  items,
  order = {},
}: {
  items: CategoryModel[];
  order?: CategoryOrder;
}): FormattedCategory[] => {
  const itemsById: Record<string, FormattedCategory> = {};
  const roots: FormattedCategory[] = [];
  const tempItems: FormattedCategory[] = items.map((item) => {
    const tempItem: FormattedCategory = {
      ...item,
      subCategories: [],
    };
    // build an id->object mapping, so we don't have to go hunting for parents
    itemsById[item.id] = tempItem;

    return tempItem;
  });

  tempItems.forEach((item) => {
    const { parentId } = item;
    // if parentId is null, this is a root; otherwise, it's parentId's kid
    const nodes = !parentId ? roots : itemsById[parentId]!.subCategories;
    nodes.push(item);
  });

  tempItems.forEach((item) => sortSiblings({ nodes: item.subCategories, orderedIds: order[item.id] }));
  return sortSiblings({ nodes: roots, orderedIds: order[CATEGORY_ORDER_ROOT_KEY] });
};
