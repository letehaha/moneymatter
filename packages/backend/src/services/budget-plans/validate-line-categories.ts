import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import { expandCategoryIdsWithDescendants, getAncestorIds } from '@services/categories/category-hierarchy';
import { Op } from 'sequelize';

import { DateRange, clipRange, rangesIntersect, subtractRanges, toRange } from './date-ranges';

/**
 * The plan owner's own categories, not `getAccessibleCategoryMap`: that one also
 * pulls in the trees of people who share accounts with the owner.
 */
export const ownerCategories = async ({ userId }: { userId: number }) => {
  const categories = await Categories.findAll({
    where: { userId },
    attributes: ['id', 'parentId'],
    raw: true,
  });

  return { categories, byId: new Map(categories.map((category) => [category.id, category])) };
};

/** The categories the plan's lines hold over any part of `range`; an archived line still owns the periods inside its lifetime. */
export const ownedCategoryIds = async ({
  planId,
  exceptLineId = null,
  range,
}: {
  planId: RecordId;
  exceptLineId?: RecordId | null;
  range: DateRange;
}): Promise<RecordId[]> => {
  const lines = await BudgetLines.findAll({
    where: { planId, ...(exceptLineId === null ? {} : { id: { [Op.ne]: exceptLineId } }) },
  });
  if (!lines.length) return [];

  const lifetimes = new Map(
    lines.map((line) => [line.id, toRange({ from: line.activeFrom, until: line.activeUntil })]),
  );
  const rows = await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lines.map((line) => line.id) } } });

  return rows
    .filter((row) => {
      const clipped = clipRange({
        range: toRange({ from: row.fromDate, until: row.untilDate }),
        bounds: lifetimes.get(row.lineId)!,
      });
      return clipped !== null && rangesIntersect({ a: clipped, b: range });
    })
    .map((row) => row.categoryId);
};

/**
 * A membership row covers its category plus every descendant, so a descendant
 * listed next to its ancestor is dropped, and two lines clash when one category
 * sits on the other's ancestor path. Returns the ids to store.
 */
export const validateLineCategories = async ({
  plan,
  lineId,
  categoryIds,
  range,
}: {
  plan: BudgetPlans;
  lineId: RecordId | null;
  categoryIds: RecordId[];
  range: DateRange;
}): Promise<RecordId[]> => {
  const { categories, byId } = await ownerCategories({ userId: plan.userId });

  if (categoryIds.some((categoryId) => !byId.has(categoryId))) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.categoryNotFound' }) });
  }

  const selected = new Set<string>(categoryIds);
  const topMostIds = categoryIds.filter(
    (categoryId) => !getAncestorIds({ categoryId, byId }).some((ancestorId) => selected.has(ancestorId)),
  );

  // A category the line already holds over the whole range skips the clash check:
  // a category-delete merge or a re-parent can leave it in an ancestor pair across lines.
  const ownRows = lineId === null ? [] : await BudgetLineCategories.findAll({ where: { lineId } });
  const addedIds = topMostIds.filter(
    (categoryId) =>
      subtractRanges({
        range,
        cuts: ownRows
          .filter((row) => row.categoryId === categoryId)
          .map((row) => toRange({ from: row.fromDate, until: row.untilDate })),
      }).length > 0,
  );

  const covered = new Set(expandCategoryIdsWithDescendants({ categoryIds: addedIds, categories, byId }));
  const ancestors = new Set(addedIds.flatMap((categoryId) => getAncestorIds({ categoryId, byId })));

  const held = await ownedCategoryIds({ planId: plan.id, exceptLineId: lineId, range });
  if (held.some((categoryId) => covered.has(categoryId) || ancestors.has(categoryId))) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.lineCategoriesOverlap' }) });
  }

  return topMostIds;
};
