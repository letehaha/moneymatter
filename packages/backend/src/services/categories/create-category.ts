import { CategoryModel, EmbeddedCategoryModel, RecordId } from '@bt/shared/types';
import * as Categories from '@models/categories.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertTagsOwnedByUser } from '@services/tags/assert-tags-owned-by-user';

import { validateParentAssignment } from './validate-parent-assignment';

export const createCategory = withTransaction(
  async ({
    defaultTagIds = [],
    ...payload
  }: Categories.CreateCategoryPayload & { defaultTagIds?: RecordId[] }): Promise<CategoryModel> => {
    if (payload.parentId) {
      const categories = await Categories.getCategories({ userId: payload.userId });
      validateParentAssignment({ categories, parentId: payload.parentId });
    }
    const tagIds = await assertTagsOwnedByUser({ userId: payload.userId, tagIds: defaultTagIds });

    const category = await Categories.createCategory(payload);
    if (tagIds.length) await category.$set('defaultTags', tagIds);

    return { ...category.toJSON<EmbeddedCategoryModel>(), defaultTagIds: tagIds };
  },
);
