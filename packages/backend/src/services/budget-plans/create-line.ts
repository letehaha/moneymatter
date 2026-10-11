import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines, { BudgetLineOrigin } from '@models/budget-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { toLineEntry } from './get-plan';
import { endOfGroupSortOrder } from './line-groups';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { validateLineCategories } from './validate-line-categories';

const createLineImpl = async ({
  userId,
  planId,
  name,
  categoryIds,
  sortOrder,
  groupId = null,
  activeFrom,
  origin = 'manual',
}: {
  userId: number;
  planId: RecordId;
  name: string;
  categoryIds: RecordId[];
  sortOrder?: number;
  groupId?: RecordId | null;
  activeFrom?: string;
  origin?: BudgetLineOrigin;
}) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { startsThroughCurrent, currentStart } = await ensureCurrentPeriods({ plan });

  if (activeFrom !== undefined && !startsThroughCurrent.includes(activeFrom)) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.activeFromNotPeriodStart' }) });
  }
  const from = activeFrom ?? currentStart;

  const topMostIds = await validateLineCategories({ plan, lineId: null, categoryIds, range: { from, until: null } });

  const endOfGroup = await endOfGroupSortOrder({ planId: plan.id, groupId });
  const line = await BudgetLines.create({
    planId: plan.id,
    name,
    groupId,
    sortOrder: sortOrder ?? endOfGroup,
    activeFrom: from,
    origin,
  });
  const lineCategories = await BudgetLineCategories.bulkCreate(
    topMostIds.map((categoryId) => ({ lineId: line.id, categoryId, fromDate: from, untilDate: null })),
  );

  return toLineEntry({ line, lineCategories, currentStart });
};

export const createLine = withTransaction(createLineImpl);
