import { BUDGET_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ForbiddenError } from '@js/errors';
import BudgetCategories from '@models/budget-categories.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import { getBudgetById } from '@services/budget.service';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from './authorize-budget-access';

// Sequelize mutates include objects while resolving them, so each nesting level needs its own instance.
const includeCategoryIds = () => ({
  model: Categories,
  as: 'categories',
  attributes: ['id'],
  through: { attributes: [] },
});

const COPY_SUFFIX = ' copy';
const MAX_NAME_LENGTH = 200;

export const duplicateBudget = withTransaction(async ({ userId, id }: { userId: number; id: string }) => {
  const { isOwner } = await authorizeBudgetAccess({ userId, budgetId: id, requiredPermission: SHARE_PERMISSIONS.read });
  if (!isOwner) {
    throw new ForbiddenError({ message: t({ key: 'budgets.onlyOwnerCanDuplicate' }) });
  }

  const source = await findOrThrowNotFound({
    query: Budgets.findOne({
      where: { id, userId },
      include: [includeCategoryIds(), { model: TrackerLines, as: 'lines', include: [includeCategoryIds()] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const copy = await Budgets.create({
    name: `${source.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    userId,
    status: BUDGET_STATUSES.active,
    type: source.type,
    limitAmount: source.limitAmount,
    startDate: null,
    endDate: null,
    autoInclude: false,
    archivePromptDismissed: false,
  });

  await BudgetCategories.bulkCreate(
    source.categories.map((category) => ({ budgetId: copy.id, categoryId: category.id })),
  );

  const sourceLines = source.lines ?? [];
  const copiedLines = await TrackerLines.bulkCreate(
    sourceLines.map((line) => ({
      budgetId: copy.id,
      name: line.name,
      limitAmount: line.limitAmount,
      position: line.position,
    })),
  );
  await TrackerLineCategories.bulkCreate(
    sourceLines.flatMap((line, index) =>
      line.categories.map((category) => ({ lineId: copiedLines[index]!.id, categoryId: category.id })),
    ),
  );

  return findOrThrowNotFound({
    query: getBudgetById({ userId, id: copy.id }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });
});
