import { BUDGET_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import BudgetCategories from '@models/budget-categories.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import { includeLines } from '@services/budget.service';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { authorizeBudgetAccess } from './authorize-budget-access';
import { expandCategoryIds } from './utils/expand-category-ids';

interface EditBudgetPayload {
  id: string;
  userId: number;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: Money | null;
  autoInclude?: boolean;
  archivePromptDismissed?: boolean;
  categoryIds?: string[];
}

const dropLineCategoriesOutsideTracker = async ({
  budgetId,
  trackerCategoryIds,
}: {
  budgetId: string;
  trackerCategoryIds: string[];
}) => {
  const lineIds = (await TrackerLines.findAll({ where: { budgetId }, attributes: ['id'] })).map((line) => line.id);
  if (!lineIds.length) return;

  await TrackerLineCategories.destroy({
    where: {
      lineId: { [Op.in]: lineIds },
      ...(trackerCategoryIds.length ? { categoryId: { [Op.notIn]: trackerCategoryIds } } : {}),
    },
  });

  const linesWithCategories = new Set(
    (await TrackerLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } }, attributes: ['lineId'] })).map(
      (row) => row.lineId,
    ),
  );
  const emptyLineIds = lineIds.filter((lineId) => !linesWithCategories.has(lineId));
  if (emptyLineIds.length) {
    await TrackerLines.destroy({ where: { id: { [Op.in]: emptyLineIds } } });
  }
};

export const editBudget = withTransaction(async ({ id, userId, categoryIds, ...params }: EditBudgetPayload) => {
  // Manage-level required: metadata edits (name/dates/limit/autoInclude/categories) are
  // owner / manage-only per PRD reduced-write-scope decision. `write` recipients can
  // attach their own transactions but not mutate the budget definition itself, which
  // avoids "my partner renamed my budget" / "categories list moved under me" surprises.
  const { ownerUserId } = await authorizeBudgetAccess({
    userId,
    budgetId: id,
    requiredPermission: SHARE_PERMISSIONS.manage,
  });

  const budget = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const startDate = params.startDate === undefined ? budget.startDate : params.startDate;
  const endDate = params.endDate === undefined ? budget.endDate : params.endDate;
  if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
    throw new ValidationError({ message: t({ key: 'budgets.startDateAfterEndDate' }) });
  }

  await budget.update(removeUndefinedKeys(params));

  if (categoryIds !== undefined && budget.type === BUDGET_TYPES.category) {
    // Categories are resolved against the OWNER's tree, so a `manage` recipient cannot
    // inject categories from their own tree.
    const expandedCategoryIds = await expandCategoryIds({ userId: ownerUserId, categoryIds });

    await BudgetCategories.destroy({ where: { budgetId: id } });
    await BudgetCategories.bulkCreate(expandedCategoryIds.map((categoryId) => ({ budgetId: id, categoryId })));

    await dropLineCategoriesOutsideTracker({ budgetId: id, trackerCategoryIds: expandedCategoryIds });
  }

  const updatedBudget = await Budgets.findOne({
    where: { id, userId: ownerUserId },
    attributes: { exclude: ['userId'] },
    include:
      budget.type === BUDGET_TYPES.category
        ? [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color', 'parentId'] }, includeLines]
        : [includeLines],
  });

  return updatedBudget;
});
