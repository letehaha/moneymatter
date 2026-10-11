import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { trackEvent } from '@js/utils/posthog';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPeriods from '@models/budget-periods.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { findLine, findPlan } from './find-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';

/** A row still open at `at` ends there; one starting there or later is removed. */
export const closeMembershipAt = async ({ row, at }: { row: BudgetLineCategories; at: string }): Promise<void> => {
  if (row.untilDate !== null && toUtcDateString(row.untilDate) <= at) return;

  if (toUtcDateString(row.fromDate) >= at) await row.destroy();
  else await row.update({ untilDate: at });
};

/**
 * Archiving ends the lifetime at the current period start, so "archive Food,
 * create Groceries + Restaurants" works inside one period. A line archived in
 * its first period keeps an empty lifetime: it owns no period but can be restored.
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
  const rows = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  await line.update({
    activeUntil: currentStart,
    archivedCategoryIds: rows
      .filter((row) => row.untilDate === null || toUtcDateString(row.untilDate) > currentStart)
      .map((row) => row.categoryId),
  });

  // The row at `currentStart` stays, unread while the line is archived, so a
  // restore in this period brings its amounts back.
  const periodIds = periods
    .filter((period) => toUtcDateString(period.startDate) > currentStart)
    .map((period) => period.id);
  await BudgetAssignments.destroy({ where: { lineId: line.id, periodId: { [Op.in]: periodIds } } });

  for (const row of rows) await closeMembershipAt({ row, at: currentStart });
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
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods, currentStart } = await ensureCurrentPeriods({ plan });
  const line = await findLine({ planId: plan.id, lineId });

  if (line.activeUntil !== null) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.lineAlreadyArchived' }) });
  }

  await archiveLineFrom({ line, periods, currentStart });
  trackEvent({ userId, event: 'budget_line_archived', properties: { origin: line.origin } });
};

export const archiveLine = withTransaction(archiveLineImpl);
