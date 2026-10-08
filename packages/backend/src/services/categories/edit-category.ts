import { CATEGORY_TYPES, CategoryModel, EmbeddedCategoryModel, RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import * as Categories from '@models/categories.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertTagsOwnedByUser } from '@services/tags/assert-tags-owned-by-user';

import { attachDefaultTagIds } from './default-tags';
import { validateParentAssignment } from './validate-parent-assignment';

const validateMove = async ({
  userId,
  category,
  parentId,
}: {
  userId: number;
  category: Categories.default;
  parentId: string | null;
}) => {
  if (category.type === CATEGORY_TYPES.internal) {
    throw new ValidationError({ message: t({ key: 'categories.systemCannotBeMoved' }) });
  }

  if (parentId === null) return;

  const categories = await Categories.getCategories({ userId });
  validateParentAssignment({ categories, categoryId: category.id, parentId });
};

export const editCategory = withTransaction(
  async ({
    defaultTagIds,
    ...payload
  }: Categories.EditCategoryPayload & { defaultTagIds?: RecordId[] }): Promise<CategoryModel[]> => {
    const { userId, categoryId, ...columns } = payload;
    const category = await findOrThrowNotFound({
      query: Categories.default.findOne({ where: { id: categoryId, userId } }),
      message: t({ key: 'categories.notFound' }),
    });
    if (columns.parentId !== undefined) {
      await validateMove({ userId, category, parentId: columns.parentId });
    }

    // An UPDATE with no columns is a no-op that returns no rows.
    const hasColumnChanges = Object.values(columns).some((value) => value !== undefined);
    let updated = category;
    if (hasColumnChanges) {
      const [row] = await Categories.editCategory(payload);
      if (!row) throw new NotFoundError({ message: t({ key: 'categories.notFound' }) });
      updated = row;
    }

    if (defaultTagIds === undefined) {
      return attachDefaultTagIds({ userId, categories: [updated.toJSON<EmbeddedCategoryModel>()] });
    }
    const tagIds = await assertTagsOwnedByUser({ userId, tagIds: defaultTagIds });
    await updated.$set('defaultTags', tagIds);
    return [{ ...updated.toJSON<EmbeddedCategoryModel>(), defaultTagIds: tagIds }];
  },
);
