import { BUDGET_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetCategories from '@models/budget-categories.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import { includeLineCategories } from '@services/budget.service';
import { Op } from 'sequelize';

import { assertCategoriesOwnedByUser } from '../utils/assert-categories-owned-by-user';
import { expandCategoryIds } from '../utils/expand-category-ids';

export const findLineOrThrow = ({ budgetId, lineId }: { budgetId: string; lineId: string }) =>
  findOrThrowNotFound({
    query: TrackerLines.findOne({
      where: { id: lineId, budgetId },
      include: [includeLineCategories],
    }),
    message: t({ key: 'budgets.lineNotFound' }),
  });

/**
 * Categories resolve against the budget owner's tree, so a `manage` recipient can't attach their own.
 * A category tracker's lines keep only categories the tracker tracks: a picked parent contributes just
 * its tracked children, so a child added to the parent after the tracker was set up stays out.
 */
export const replaceLineCategories = async ({
  budgetId,
  lineId,
  ownerUserId,
  categoryIds,
}: {
  budgetId: string;
  lineId: string;
  ownerUserId: number;
  categoryIds: string[];
}) => {
  const uniqueIds = await assertCategoriesOwnedByUser({ userId: ownerUserId, categoryIds });

  let lineCategoryIds = await expandCategoryIds({ userId: ownerUserId, categoryIds: uniqueIds });

  const budget = await Budgets.findByPk(budgetId, { attributes: ['type'] });
  if (budget?.type === BUDGET_TYPES.category) {
    const trackerIds = new Set<string>(
      (await BudgetCategories.findAll({ where: { budgetId }, attributes: ['categoryId'] })).map(
        (row) => row.categoryId,
      ),
    );
    const children = await Categories.findAll({
      where: { userId: ownerUserId, parentId: { [Op.in]: uniqueIds } },
      attributes: ['id', 'parentId'],
    });
    const isRequestedIdTracked = (id: string) =>
      trackerIds.has(id) || children.some((child) => child.parentId === id && trackerIds.has(child.id));

    lineCategoryIds = lineCategoryIds.filter((id) => trackerIds.has(id));
    if (!uniqueIds.every(isRequestedIdTracked) || !lineCategoryIds.length) {
      throw new ValidationError({ message: t({ key: 'budgets.lineCategoryOutsideTracker' }) });
    }
  }

  await TrackerLineCategories.destroy({ where: { lineId } });
  await TrackerLineCategories.bulkCreate(lineCategoryIds.map((categoryId) => ({ lineId, categoryId })));
};
