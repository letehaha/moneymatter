import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import { expandCategoryIdsWithDescendants, getAncestorIds } from '@services/categories/category-hierarchy';
import { Op } from 'sequelize';

import { DateRange, clipRange, rangesIntersect, toRange } from './date-ranges';

/**
 * The plan owner's own categories, not `getAccessibleCategoryMap`: that one also
 * pulls in the trees of people who share accounts with the owner.
 */
const ownerCategories = async ({ userId }: { userId: number }) => {
  const categories = await Categories.findAll({
    where: { userId },
    attributes: ['id', 'parentId'],
    raw: true,
  });

  return { categories, byId: new Map(categories.map((category) => [category.id, category])) };
};

/**
 * A membership row covers its category plus every descendant, so two rows clash
 * when one category sits on the other's ancestor path.
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
}): Promise<void> => {
  const { categories, byId } = await ownerCategories({ userId: plan.userId });

  const selected = new Set<string>(categoryIds);
  for (const categoryId of categoryIds) {
    if (!byId.has(categoryId)) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.categoryNotFound' }) });
    }
    if (getAncestorIds({ categoryId, byId }).some((ancestorId) => selected.has(ancestorId))) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.lineCategoriesRedundant' }) });
    }
  }

  const covered = new Set(expandCategoryIdsWithDescendants({ categoryIds, categories, byId }));
  const ancestors = new Set(categoryIds.flatMap((categoryId) => getAncestorIds({ categoryId, byId })));

  const otherLines = await BudgetLines.findAll({
    where: { planId: plan.id, ...(lineId === null ? {} : { id: { [Op.ne]: lineId } }) },
  });
  if (!otherLines.length) return;

  // An archived line still owns the periods inside its lifetime.
  const lifetimes = new Map(
    otherLines.map((line) => [line.id, toRange({ from: line.activeFrom, until: line.activeUntil })]),
  );
  const rows = await BudgetLineCategories.findAll({
    where: { lineId: { [Op.in]: otherLines.map((line) => line.id) } },
  });

  for (const row of rows) {
    if (!covered.has(row.categoryId) && !ancestors.has(row.categoryId)) continue;

    const bounds = lifetimes.get(row.lineId)!;
    const clipped = clipRange({ range: toRange({ from: row.fromDate, until: row.untilDate }), bounds });
    if (clipped && rangesIntersect({ a: clipped, b: range })) {
      throw new ConflictError({ message: t({ key: 'budgetPlans.lineCategoriesOverlap' }) });
    }
  }
};
