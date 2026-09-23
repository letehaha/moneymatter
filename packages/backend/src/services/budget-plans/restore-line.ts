import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetPeriods from '@models/budget-periods.model';
import { withTransaction } from '@services/common/with-transaction';

import { covers } from './date-ranges';
import { findLine, findPlan } from './find-plan';
import { toLineEntry } from './get-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { validateLineCategories } from './validate-line-categories';

/**
 * The periods spent archived read 0 as one-off overrides. A 0 baseline would keep
 * recurring past them once a later archive drops whatever was written at `currentStart`.
 */
const zeroArchivedPeriods = async ({
  lineId,
  periods,
  archivedAt,
  currentStart,
}: {
  lineId: RecordId;
  periods: BudgetPeriods[];
  archivedAt: string;
  currentStart: string;
}): Promise<void> => {
  const rows = await BudgetAssignments.findAll({ where: { lineId } });
  const baseline = periods
    .filter((period) => toUtcDateString(period.startDate) < archivedAt)
    .map((period) => rows.find((row) => row.periodId === period.id)?.baselineAmount)
    .findLast((amount) => amount != null);
  if (!baseline || baseline.isZero()) return;

  await BudgetAssignments.bulkCreate(
    periods
      .filter((period) =>
        covers({ range: { from: archivedAt, until: currentStart }, start: toUtcDateString(period.startDate) }),
      )
      .map((period) => ({ periodId: period.id, lineId, overrideAmount: Money.zero() })),
  );
};

/**
 * The line resumes from the current period with the categories it held when
 * archived. A row the archive closed at `currentStart` reopens; the rest start anew there.
 */
const restoreLineImpl = async ({ userId, planId, lineId }: { userId: number; planId: RecordId; lineId: RecordId }) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods, currentStart } = await ensureCurrentPeriods({ plan });
  const line = await findLine({ planId: plan.id, lineId });

  if (line.activeUntil === null) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.lineNotArchived' }) });
  }

  const categoryIds = await validateLineCategories({
    plan,
    lineId: line.id,
    categoryIds: line.archivedCategoryIds,
    range: { from: currentStart, until: null },
  });

  const rows = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  for (const categoryId of categoryIds) {
    const closedHere = rows.find(
      (row) =>
        row.categoryId === categoryId && row.untilDate !== null && toUtcDateString(row.untilDate) === currentStart,
    );
    if (closedHere) await closedHere.update({ untilDate: null });
    else await BudgetLineCategories.create({ lineId: line.id, categoryId, fromDate: currentStart, untilDate: null });
  }

  const archivedAt = toUtcDateString(line.activeUntil);
  if (archivedAt < currentStart) await zeroArchivedPeriods({ lineId: line.id, periods, archivedAt, currentStart });

  // A line that never owned a period starts over here, not in empty periods behind it.
  const neverOwned = archivedAt === toUtcDateString(line.activeFrom);
  await line.update({
    activeFrom: neverOwned ? currentStart : line.activeFrom,
    activeUntil: null,
    archivedCategoryIds: [],
  });

  const lineCategories = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  return toLineEntry({ line, lineCategories, currentStart });
};

export const restoreLine = withTransaction(restoreLineImpl);
