import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import { includeLineCategories } from '@services/trackers/get-trackers';

import { assertCategoriesOwnedByUser } from '../utils/assert-categories-owned-by-user';
import { expandCategoryIds } from '../utils/expand-category-ids';

export const findLineOrThrow = ({ trackerId, lineId }: { trackerId: string; lineId: string }) =>
  findOrThrowNotFound({
    query: TrackerLines.findOne({
      where: { id: lineId, trackerId },
      include: [includeLineCategories],
    }),
    message: t({ key: 'budgets.lineNotFound' }),
  });

/** Categories resolve against the tracker owner's tree, so a `manage` recipient can't attach their own. */
export const replaceLineCategories = async ({
  lineId,
  ownerUserId,
  categoryIds,
}: {
  lineId: string;
  ownerUserId: number;
  categoryIds: string[];
}) => {
  const uniqueIds = await assertCategoriesOwnedByUser({ userId: ownerUserId, categoryIds });

  const lineCategoryIds = await expandCategoryIds({ userId: ownerUserId, categoryIds: uniqueIds });

  await TrackerLineCategories.destroy({ where: { lineId } });
  await TrackerLineCategories.bulkCreate(lineCategoryIds.map((categoryId) => ({ lineId, categoryId })));
};
