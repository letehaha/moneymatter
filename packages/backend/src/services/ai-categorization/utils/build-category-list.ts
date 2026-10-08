import { CategoryModel } from '@bt/shared/types';

import { CategoryForCategorization } from '../types';

/**
 * Build category list from flat CategoryModel array
 */
export function buildCategoryList(
  categories: Pick<CategoryModel, 'id' | 'parentId' | 'name'>[],
): CategoryForCategorization[] {
  return categories.map((cat) => ({
    id: cat.id,
    parentId: cat.parentId,
    name: cat.name,
  }));
}
