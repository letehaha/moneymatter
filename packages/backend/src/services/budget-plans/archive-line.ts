import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPeriods from '@models/budget-periods.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { lockPlan } from './lock-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';

/**
 * Archiving ends the lifetime at the current period start, so "archive Food,
 * create Groceries + Restaurants" works inside one period. A line that never
 * owned a closed period would be left owning nothing, so it is deleted.
 */
export const archiveLineFrom = async ({
  line,
  periods,
  currentStart,
}: {
  line: BudgetLines;
  periods: BudgetPeriods[];
  currentStart: string;
}): Promise<void> => {
  if (currentStart <= toUtcDateString(line.activeFrom)) {
    await line.destroy();
    return;
  }

  await line.update({ activeUntil: currentStart });

  const periodIds = periods
    .filter((period) => toUtcDateString(period.startDate) >= currentStart)
    .map((period) => period.id);
  await BudgetAssignments.destroy({ where: { lineId: line.id, periodId: { [Op.in]: periodIds } } });

  const rows = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  for (const row of rows) {
    if (row.untilDate !== null && toUtcDateString(row.untilDate) <= currentStart) continue;

    if (toUtcDateString(row.fromDate) >= currentStart) await row.destroy();
    else await row.update({ untilDate: currentStart });
  }
};

const archiveLineImpl = async ({
  userId,
  planId,
  lineId,
}: {
  userId: number;
  planId: RecordId;
  lineId: RecordId;
}): Promise<void> => {
  const plan = await lockPlan({ planId, userId });
  const { periods, currentStart } = await ensureCurrentPeriods({ plan });

  const line = await findOrThrowNotFound({
    query: BudgetLines.findOne({ where: { id: lineId, planId: plan.id } }),
    message: t({ key: 'budgetPlans.lineNotFound' }),
  });

  if (line.activeUntil !== null) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.lineAlreadyArchived' }) });
  }

  await archiveLineFrom({ line, periods, currentStart });
};

export const archiveLine = withTransaction(archiveLineImpl);
