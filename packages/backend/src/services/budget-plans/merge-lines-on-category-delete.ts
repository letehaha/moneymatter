import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import { getAncestorIds } from '@services/categories/category-hierarchy';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { archiveLineFrom } from './archive-line';
import { DateRange, clipRange, covers, rangesIntersect, subtractRanges, toRange } from './date-ranges';
import { lockPlansByIds } from './find-plan';
import { MergeWrite, mergeLineAmounts } from './fold/merge-line-amounts';
import { AssignmentAmounts, assignmentCents, isEmptyAssignment } from './fold/resolve-assigned';
import { ensurePeriods, loadPeriods } from './periods/ensure-periods';
import { boundaryAtOrBefore } from './periods/period-enumerator';
import { ownerCategories } from './validate-line-categories';

interface Entry {
  row: BudgetLineCategories;
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
  for (const line of lines.filter((item) => item.archivedCategoryIds.includes(categoryId))) {
    const kept = line.archivedCategoryIds.filter((id) => id !== categoryId);
    await line.update({
      archivedCategoryIds: replacementId === null || kept.includes(replacementId) ? kept : [...kept, replacementId],
    });
  }

  const lineIds = lines.map((line) => line.id);
  const membership = await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } });
  if (!membership.some((row) => row.categoryId === categoryId)) return;

  const today = toUtcDateString(new Date());
  // A soft-deleted plan gets no new periods: what is stored is its whole world.
  const periods = plan.deletedAt ? await loadPeriods({ planId: plan.id }) : await ensurePeriods({ plan, today });
  // The period today falls into, which a trashed plan may not have stored.
  const currentStart = boundaryAtOrBefore({ plan, date: today });
  const startById = new Map<string, string>(periods.map((period) => [period.id, toUtcDateString(period.startDate)]));

  const [assignments, { byId }] = await Promise.all([
    BudgetAssignments.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
    ownerCategories({ userId: plan.userId }),
  ]);

  const replacementPath = new Set(
    replacementId === null ? [] : [replacementId, ...getAncestorIds({ categoryId: replacementId, byId })],
  );

  const lifetimes = new Map<string, DateRange>(
    lines.map((line) => [line.id, toRange({ from: line.activeFrom, until: line.activeUntil })]),
  );
  const entries: Entry[] = membership.map((row) => ({
    row,
    range: toRange({ from: row.fromDate, until: row.untilDate }),
    live: true,
  }));
  const affected = entries.filter((entry) => entry.row.categoryId === categoryId);
  const affectedLineIds = new Set(affected.map((entry) => entry.row.lineId));

  for (const entry of affected) {
    if (replacementId === null) {
      await drop({ entry });
      continue;
    }

    const { lineId } = entry.row;
    // Periods already covered stay with their holder: in this line the replacement
    // or an ancestor, in another line the replacement itself within its lifetime.
    const cuts = entries.flatMap((other): DateRange[] => {
      if (!other.live || other === entry) return [];
      if (other.row.lineId === lineId) return replacementPath.has(other.row.categoryId) ? [other.range] : [];
      if (other.row.categoryId !== replacementId) return [];

      const clipped = clipRange({ range: other.range, bounds: lifetimes.get(other.row.lineId)! });
      return clipped ? [clipped] : [];
    });
    const [first, ...rest] = subtractRanges({ range: entry.range, cuts });
    if (!first) {
      await drop({ entry });
      continue;
    }

    // The swap may leave an ancestor/descendant pair across lines; the fold
    // resolves that by nearest ancestor, so the overlap check stays out of it.
    entry.range = first;
    await entry.row.update({ categoryId: replacementId, fromDate: first.from, untilDate: first.until });
    const parts = [entry];
    for (const range of rest) {
      const part = {
        row: await BudgetLineCategories.create({
          lineId,
          categoryId: replacementId,
          fromDate: range.from,
          untilDate: range.until,
        }),
        range,
        live: true,
      };
      parts.push(part);
      entries.push(part);
    }

    // Inside the line the replacement covers its descendants, so they are cut
    // back to where it starts. One that outlives it overlaps only closed periods.
    for (const part of parts) {
      for (const other of entries) {
        if (
          !other.live ||
          other.row.lineId !== lineId ||
          !rangesIntersect({ a: other.range, b: part.range }) ||
          !getAncestorIds({ categoryId: other.row.categoryId, byId }).includes(replacementId) ||
          (part.range.until !== null && (other.range.until === null || other.range.until > part.range.until))
        ) {
          continue;
        }

        if (other.range.from >= part.range.from) {
          await drop({ entry: other });
        } else {
          other.range = { from: other.range.from, until: part.range.from };
          await other.row.update({ untilDate: part.range.from });
        }
      }
    }
  }

  const rowsByLine = new Map<string, Map<string, AssignmentAmounts>>();
  const instances = new Map<string, BudgetAssignments>();
  const rowsOf = ({ lineId }: { lineId: string }): Map<string, AssignmentAmounts> => {
    const bucket = rowsByLine.get(lineId) ?? new Map<string, AssignmentAmounts>();
    rowsByLine.set(lineId, bucket);
    return bucket;
  };

  for (const row of assignments) {
    instances.set(`${row.lineId}:${row.periodId}`, row);
    rowsOf({ lineId: row.lineId }).set(row.periodId, assignmentCents(row));
  }

  const periodIdsOf = ({ lineId }: { lineId: string }): string[] =>
    periods
      .filter((period) => covers({ range: lifetimes.get(lineId)!, start: startById.get(period.id)! }))
      .map((period) => period.id);

  const applyWrites = async ({ lineId, writes }: { lineId: string; writes: MergeWrite[] }): Promise<void> => {
    const rows = rowsOf({ lineId });

    for (const { periodId, row } of writes) {
      const key = `${lineId}:${periodId}`;
      const existing = instances.get(key);
      if (row === null || isEmptyAssignment(row)) {
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

  const liveIn = ({ lineId }: { lineId: string }) =>
    entries.filter((entry) => entry.live && entry.row.lineId === lineId);
  const emptied = lines.filter(
    (line) =>
      affectedLineIds.has(line.id) &&
      !liveIn({ lineId: line.id }).some((entry) => covers({ range: entry.range, start: currentStart })),
  );

  const holders = entries
    .filter((entry) => entry.live && entry.row.categoryId === replacementId)
    .map((entry) => ({
      lineId: entry.row.lineId,
      window: clipRange({ range: entry.range, bounds: lifetimes.get(entry.row.lineId)! }),
    }))
    .filter((holder): holder is { lineId: RecordId; window: DateRange } => holder.window !== null)
    .toSorted((a, b) => a.window.from.localeCompare(b.window.from));

  for (const line of emptied) {
    const kept = liveIn({ lineId: line.id });
    const sourcePeriodIds = periodIdsOf({ lineId: line.id });

    for (const holder of holders) {
      const targetPeriodIds = periodIdsOf({ lineId: holder.lineId });
      // A period the line still covers keeps its amounts, which also keeps the
      // line's own swapped rows from merging it into itself. It splits the shared
      // periods into runs, since a merge sums baselines across one unbroken run.
      const runs: string[][] = [[]];
      for (const periodId of sourcePeriodIds) {
        const start = startById.get(periodId)!;
        if (!targetPeriodIds.includes(periodId) || !covers({ range: holder.window, start })) continue;
        if (kept.some((entry) => covers({ range: entry.range, start }))) runs.push([]);
        else runs.at(-1)!.push(periodId);
      }

      for (const sharedPeriodIds of runs) {
        const writes = mergeLineAmounts({
          source: { periodIds: sourcePeriodIds, rows: rowsOf({ lineId: line.id }) },
          target: { periodIds: targetPeriodIds, rows: rowsOf({ lineId: holder.lineId }) },
          sharedPeriodIds,
        });

        await applyWrites({ lineId: line.id, writes: writes.source });
        await applyWrites({ lineId: holder.lineId, writes: writes.target });
      }
    }

    // The archive below ends everything at `currentStart`, so only a membership row or
    // an assignment row in an earlier period of its lifetime leaves the line anything to own.
    const rows = rowsOf({ lineId: line.id });
    if (
      !kept.length &&
      !sourcePeriodIds.some((periodId) => rows.has(periodId) && startById.get(periodId)! < currentStart)
    ) {
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
  replacementCategoryId: RecordId | null;
}): Promise<void> => {
  // Membership is read per plan under its lock: a concurrent create/updateLine
  // holds that lock while inserting the row this delete would cascade away.
  const owned = await BudgetPlans.findAll({ where: { userId }, paranoid: false, attributes: ['id'] });
  if (!owned.length) return;

  const plans = await lockPlansByIds({ planIds: owned.map((plan) => plan.id), userId });

  for (const plan of plans) {
    await mergePlanLines({ plan, categoryId, replacementId: replacementCategoryId });
  }
};

export const mergeLinesOnCategoryDelete = withTransaction(mergeLinesOnCategoryDeleteImpl);
