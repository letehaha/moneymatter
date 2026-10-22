import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import TrackerCategories from '@models/tracker-categories.model';
import TrackerTags from '@models/tracker-tags.model';
import { assertTagsOwnedByUser } from '@services/tags/assert-tags-owned-by-user';

import { assertCategoriesOwnedByUser } from '../utils/assert-categories-owned-by-user';
import { expandCategoryIds } from '../utils/expand-category-ids';
import { syncTrackerRules } from './sync-tracker-rules';

/**
 * Replaces the rule categories/tags that were passed (`undefined` keeps them), then syncs when rules are on.
 * Ids resolve against the owner's data.
 */
export const saveTrackerRules = async ({
  trackerId,
  ownerUserId,
  rulesEnabled,
  categoryIds,
  tagIds,
}: {
  trackerId: string;
  ownerUserId: number;
  rulesEnabled: boolean;
  categoryIds?: string[];
  tagIds?: string[];
}) => {
  if (categoryIds !== undefined) {
    const uniqueIds = await assertCategoriesOwnedByUser({ userId: ownerUserId, categoryIds });
    const expandedIds = await expandCategoryIds({ userId: ownerUserId, categoryIds: uniqueIds });
    await TrackerCategories.destroy({ where: { trackerId } });
    await TrackerCategories.bulkCreate(expandedIds.map((categoryId) => ({ trackerId, categoryId })));
  }
  if (tagIds !== undefined) {
    const uniqueIds = await assertTagsOwnedByUser({ userId: ownerUserId, tagIds });
    await TrackerTags.destroy({ where: { trackerId } });
    await TrackerTags.bulkCreate(uniqueIds.map((tagId) => ({ trackerId, tagId })));
  }

  if (rulesEnabled) {
    const [categoriesCount, tagsCount] = await Promise.all([
      TrackerCategories.count({ where: { trackerId } }),
      TrackerTags.count({ where: { trackerId } }),
    ]);
    if (!categoriesCount && !tagsCount) {
      throw new ValidationError({ message: t({ key: 'budgets.rulesNeedCategoryOrTag' }) });
    }
    await syncTrackerRules({ trackerId });
  }
};
