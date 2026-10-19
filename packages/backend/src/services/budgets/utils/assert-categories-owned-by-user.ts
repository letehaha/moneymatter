import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Categories from '@models/categories.model';
import { Op } from 'sequelize';

/** Throws unless every category belongs to the user. Returns the ids deduped. */
export const assertCategoriesOwnedByUser = async ({
  userId,
  categoryIds,
}: {
  userId: number;
  categoryIds: string[];
}): Promise<string[]> => {
  const uniqueIds = [...new Set(categoryIds)];
  if (!uniqueIds.length) return uniqueIds;
  const ownedCount = await Categories.count({ where: { id: { [Op.in]: uniqueIds }, userId } });
  if (ownedCount !== uniqueIds.length) {
    throw new ValidationError({ message: t({ key: 'budgets.someCategoryIdsInvalid' }) });
  }
  return uniqueIds;
};
