import { MAX_CATEGORIES_NESTING, CATEGORY_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

import { getAncestorIds } from './category-hierarchy';

interface CategoryNode {
  id: string;
  parentId: string | null;
  type: CATEGORY_TYPES;
}

// Any height at or past the limit already fails the depth check, so the descent stops there.
const getSubtreeHeight = ({ categoryId, categories }: { categoryId: string; categories: CategoryNode[] }): number => {
  let height = 1;
  let level = new Set<string>([categoryId]);

  while (height < MAX_CATEGORIES_NESTING) {
    const children = categories.filter((item) => item.parentId && level.has(item.parentId));
    if (!children.length) break;
    height += 1;
    level = new Set<string>(children.map((item) => item.id));
  }

  return height;
};

/**
 * Guards every write that points a category at a parent: creating under one and
 * re-parenting onto one. `categoryId` is absent for a not-yet-created category
 * (subtree height 1, no self/descendant conflicts possible).
 */
export const validateParentAssignment = ({
  categories,
  categoryId,
  parentId,
}: {
  categories: CategoryNode[];
  categoryId?: string;
  parentId: string;
}) => {
  const byId = new Map<string, CategoryNode>(categories.map((item) => [item.id, item]));
  const parent = byId.get(parentId);

  if (!parent) {
    throw new ValidationError({ message: t({ key: 'categories.parentNotFound' }) });
  }

  if (parent.type === CATEGORY_TYPES.internal) {
    throw new ValidationError({ message: t({ key: 'categories.systemParentForbidden' }) });
  }

  const parentAncestors = getAncestorIds({ categoryId: parent.id, byId });

  if (categoryId) {
    if (parent.id === categoryId) {
      throw new ValidationError({ message: t({ key: 'categories.ownParent' }) });
    }
    if (parentAncestors.includes(categoryId)) {
      throw new ValidationError({ message: t({ key: 'categories.underOwnSubcategory' }) });
    }
  }

  const parentDepth = 1 + parentAncestors.length;
  const subtreeHeight = categoryId ? getSubtreeHeight({ categoryId, categories }) : 1;

  if (parentDepth + subtreeHeight > MAX_CATEGORIES_NESTING) {
    throw new ValidationError({
      message: t({ key: 'categories.nestingTooDeep', variables: { max: MAX_CATEGORIES_NESTING } }),
    });
  }
};
