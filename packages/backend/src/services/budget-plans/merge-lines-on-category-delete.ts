import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import { getAncestorIds } from '@services/categories/category-hierarchy';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { archiveLineFrom } from './archive-line';
import { DateRange, clipRange, rangesIntersect, toRange } from './date-ranges';
import { lockPlansByIds } from './lock-plan';
import { MergeRow, MergeWrite, mergeLineAmounts } from './merge-line-amounts';
import { ensurePeriods, loadPeriods } from './periods/ensure-periods';
import { boundaryAtOrBefore } from './periods/period-enumerator';

const covers = ({ range, start }: { range: DateRange; start: string }): boolean =>
  range.from <= start && (range.until === null || start < range.until);

interface Entry {
  row: BudgetLineCategories;
  categoryId: string;
  range: DateRange;
  live: boolean;
}

const drop = async ({ entry }: { entry: Entry }): Promise<void> => {
  entry.live = false;
  await entry.row.destroy();
};

const mergePlanLines = async ({
  plan,
  categoryId,
  replacementId,
}: {
  plan: BudgetPlans;
  categoryId: RecordId;
  replacementId: RecordId | null;
}): Promise<void> => {
  const lines = await BudgetLines.findAll({ where: { planId: plan.id } });
  const lineIds = lines.map((line) => line.id);
  const membership = await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } });
  if (!membership.some((row) => row.categoryId === categoryId)) return;

  // A soft-deleted plan gets no new periods: what is stored is its whole world.
  const periods = plan.deletedAt
    ? await loadPeriods({ planId: plan.id })
    : await ensurePeriods({ plan, upTo: toUtcDateString(new Date()) });
  // The period today falls into, which for a trashed plan is past every stored one.
  const currentStart = boundaryAtOrBefore({ plan, date: toUtcDateString(new Date()) });
  const startById = new Map<string, string>(periods.map((period) => [period.id, toUtcDateString(period.startDate)]));

  const [assignments, categories] = await Promise.all([
    BudgetAssignments.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
    Categories.findAll({ where: { userId: plan.userId }, attributes: ['id', 'parentId'] }),
  ]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const replacementPath = new Set(
    replacementId === null ? [] : [replacementId, ...getAncestorIds({ categoryId: replacementId, byId })],
  );

  const lifetimes = new Map<string, DateRange>(
    lines.map((line) => [line.id, toRange({ from: line.activeFrom, until: line.activeUntil })]),
  );
  const entries: Entry[] = membership.map((row) => ({
    row,
    categoryId: row.categoryId,
    range: toRange({ from: row.fromDate, until: row.untilDate }),
    live: true,
  }));
  const affected = entries.filter((entry) => entry.categoryId === categoryId);
  const affectedLineIds = new Set(affected.map((entry) => entry.row.lineId));

  for (const entry of affected) {
    if (replacementId === null) {
      await drop({ entry });
      continue;
    }

    const alreadyCovered = entries.some(
      (other) =>
        other !== entry &&
        other.live &&
        other.row.lineId === entry.row.lineId &&
        replacementPath.has(other.categoryId) &&
        rangesIntersect({ a: other.range, b: entry.range }),
    );
    if (alreadyCovered) {
      await drop({ entry });
      continue;
    }

    const heldByAnotherLine = entries.some((other) => {
      if (!other.live || other.row.lineId === entry.row.lineId || other.categoryId !== replacementId) return false;

      const clipped = clipRange({ range: other.range, bounds: lifetimes.get(other.row.lineId)! });
      return clipped !== null && rangesIntersect({ a: clipped, b: entry.range });
    });
    if (heldByAnotherLine) {
      await drop({ entry });
      continue;
    }

    // The swap may leave an ancestor/descendant pair across lines; the fold
    // resolves that by nearest ancestor, so the overlap check stays out of it.
    entry.categoryId = replacementId;
    await entry.row.update({ categoryId: replacementId });
  }

  const rowsByLine = new Map<string, Map<string, MergeRow>>();
  const instances = new Map<string, BudgetAssignments>();
  const rowsOf = (lineId: string): Map<string, MergeRow> => {
    const bucket = rowsByLine.get(lineId) ?? new Map<string, MergeRow>();
    rowsByLine.set(lineId, bucket);
    return bucket;
  };

  for (const row of assignments) {
    instances.set(`${row.lineId}:${row.periodId}`, row);
    rowsOf(row.lineId).set(row.periodId, {
      baselineAmount: row.baselineAmount === null ? null : row.baselineAmount.toCents(),
      overrideAmount: row.overrideAmount === null ? null : row.overrideAmount.toCents(),
      carryPolicy: row.carryPolicy,
    });
  }

  const periodIdsOf = (lineId: string): string[] =>
    periods
      .filter((period) => covers({ range: lifetimes.get(lineId)!, start: startById.get(period.id)! }))
      .map((period) => period.id);

  const applyWrites = async ({ lineId, writes }: { lineId: string; writes: MergeWrite[] }): Promise<void> => {
    const rows = rowsOf(lineId);

    for (const { periodId, row } of writes) {
      const key = `${lineId}:${periodId}`;
      const existing = instances.get(key);
      const empty =
        row === null || (row.baselineAmount === null && row.overrideAmount === null && row.carryPolicy === null);

      if (empty) {
        if (existing) await existing.destroy();
        instances.delete(key);
        rows.delete(periodId);
        continue;
      }

      const values = {
        baselineAmount: row.baselineAmount === null ? null : Money.fromCents(row.baselineAmount),
        overrideAmount: row.overrideAmount === null ? null : Money.fromCents(row.overrideAmount),
        carryPolicy: row.carryPolicy,
      };
      if (existing) await existing.update(values);
      else instances.set(key, await BudgetAssignments.create({ periodId, lineId, ...values }));
      rows.set(periodId, row);
    }
  };

  const emptied = lines.filter(
    (line) => affectedLineIds.has(line.id) && !entries.some((entry) => entry.live && entry.row.lineId === line.id),
  );

  for (const line of emptied) {
    const holders = entries
      .filter((entry) => entry.live && entry.categoryId === replacementId)
      .map((entry) => ({
        lineId: entry.row.lineId,
        window: clipRange({ range: entry.range, bounds: lifetimes.get(entry.row.lineId)! }),
      }))
      .filter((holder): holder is { lineId: RecordId; window: DateRange } => holder.window !== null)
      .toSorted((a, b) => a.window.from.localeCompare(b.window.from));

    const sourcePeriodIds = periodIdsOf(line.id);

    for (const holder of holders) {
      const targetPeriodIds = periodIdsOf(holder.lineId);
      const sharedPeriodIds = targetPeriodIds.filter(
        (periodId) =>
          sourcePeriodIds.includes(periodId) && covers({ range: holder.window, start: startById.get(periodId)! }),
      );
      const writes = mergeLineAmounts({
        source: { periodIds: sourcePeriodIds, rows: rowsOf(line.id) },
        target: { periodIds: targetPeriodIds, rows: rowsOf(holder.lineId) },
        sharedPeriodIds,
      });

      await applyWrites({ lineId: line.id, writes: writes.source });
      await applyWrites({ lineId: holder.lineId, writes: writes.target });
    }

    // The archive below destroys every row from `currentStart` on, so only an
    // earlier one leaves the line with anything to own.
    if (![...rowsOf(line.id).keys()].some((periodId) => startById.get(periodId)! < currentStart)) {
      await line.destroy();
      continue;
    }
    if (line.activeUntil === null) await archiveLineFrom({ line, periods, currentStart });
  }
};

const mergeLinesOnCategoryDeleteImpl = async ({
  userId,
  categoryId,
  replacementCategoryId,
}: {
  userId: number;
  categoryId: RecordId;
  replacementCategoryId?: RecordId | null;
}): Promise<void> => {
  // Membership is read per plan under its lock: a concurrent create/updateLine
  // holds that lock while inserting the row this delete would cascade away.
  const owned = await BudgetPlans.findAll({ where: { userId }, paranoid: false, attributes: ['id'] });
  if (!owned.length) return;

  const plans = await lockPlansByIds({ planIds: owned.map((plan) => plan.id), userId });

  for (const plan of plans) {
    await mergePlanLines({ plan, categoryId, replacementId: replacementCategoryId ?? null });
  }
};

export const mergeLinesOnCategoryDelete = withTransaction(mergeLinesOnCategoryDeleteImpl);
