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
 * The periods spent archived read 0 as one-off overrides, which leaves the baseline
 * in force at the archive, the archive period's own included, to resume by itself.
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
  const rowOf = ({ period }: { period: BudgetPeriods }) => rows.find((row) => row.periodId === period.id);
  const baseline = periods
    .filter((period) => toUtcDateString(period.startDate) <= archivedAt)
    .map((period) => rowOf({ period })?.baselineAmount)
    .findLast((amount) => amount != null);
  const recurs = !!baseline && !baseline.isZero();

  const archived = periods.filter((period) =>
    covers({ range: { from: archivedAt, until: currentStart }, start: toUtcDateString(period.startDate) }),
  );
  for (const period of archived) {
    const row = rowOf({ period });
    if (row && (recurs || row.overrideAmount)) await row.update({ overrideAmount: Money.zero() });
  }
  if (!recurs) return;

  await BudgetAssignments.bulkCreate(
    archived
      .filter((period) => !rowOf({ period }))
      .map((period) => ({ periodId: period.id, lineId, overrideAmount: Money.zero() })),
  );
};

/**
 * A line that never owned a period starts over at `currentStart`, so the baseline
 * and carry policy of its archive period move there; that period's one-off does not.
 */
const moveArchivePeriodRow = async ({
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
  const periodAt = ({ start }: { start: string }) =>
    periods.find((period) => toUtcDateString(period.startDate) === start);
  const from = periodAt({ start: archivedAt });
  const to = periodAt({ start: currentStart });
  if (!from || !to) return;

  const row = await BudgetAssignments.findOne({ where: { lineId, periodId: from.id } });
  if (!row) return;

  const { baselineAmount, carryPolicy } = row;
  await row.destroy();
  if (baselineAmount !== null || carryPolicy !== null) {
    await BudgetAssignments.create({ periodId: to.id, lineId, baselineAmount, carryPolicy });
  }
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
  // A line that never owned a period starts over here, not in empty periods behind it.
  const neverOwned = archivedAt === toUtcDateString(line.activeFrom);
  if (archivedAt < currentStart) {
    const gap = { lineId: line.id, periods, archivedAt, currentStart };
    await (neverOwned ? moveArchivePeriodRow(gap) : zeroArchivedPeriods(gap));
  }

  await line.update({
    activeFrom: neverOwned ? currentStart : line.activeFrom,
    activeUntil: null,
    archivedCategoryIds: [],
  });

  const lineCategories = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  return toLineEntry({ line, lineCategories, currentStart });
};

export const restoreLine = withTransaction(restoreLineImpl);
