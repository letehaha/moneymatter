import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { toLineEntry } from './get-plan';
import { lockPlan } from './lock-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { validateLineCategories } from './validate-line-categories';

const createLineImpl = async ({
  userId,
  planId,
  name,
  categoryIds,
  sortOrder = 0,
  activeFrom,
}: {
  userId: number;
  planId: RecordId;
  name: string;
  categoryIds: RecordId[];
  sortOrder?: number;
  activeFrom?: string;
}) => {
  const plan = await lockPlan({ planId, userId });
  const { starts, currentStart } = await ensureCurrentPeriods({ plan });

  // Stored periods run epoch -> current, so membership is the whole check: an
  // earlier date is not a boundary, a later one is in the future.
  if (activeFrom !== undefined && !starts.includes(activeFrom)) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.activeFromNotPeriodStart' }) });
  }
  const from = activeFrom ?? currentStart;

  await validateLineCategories({ plan, lineId: null, categoryIds, range: { from, until: null } });

  const line = await BudgetLines.create({ planId: plan.id, name, sortOrder, activeFrom: from });
  const lineCategories = await BudgetLineCategories.bulkCreate(
    categoryIds.map((categoryId) => ({ lineId: line.id, categoryId, fromDate: from, untilDate: null })),
  );

  return toLineEntry({ line, lineCategories, currentStart });
};

export const createLine = withTransaction(createLineImpl);
