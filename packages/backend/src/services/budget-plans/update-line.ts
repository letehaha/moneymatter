import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { toLineEntry } from './get-plan';
import { lockPlan } from './lock-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { validateLineCategories } from './validate-line-categories';

/**
 * No two rows of one (line, category) may end up with intersecting ranges, so a
 * kept category absorbs every row of its own that reaches `from`.
 * Membership must not outlive the line, so writes close at `until`, which is
 * null while the line is live.
 */
const applyMembership = async ({
  lineId,
  categoryIds,
  from,
  until,
}: {
  lineId: RecordId;
  categoryIds: RecordId[];
  from: string;
  until: string | null;
}): Promise<void> => {
  const rows = await BudgetLineCategories.findAll({ where: { lineId } });
  const reaches = (row: BudgetLineCategories) => row.untilDate === null || toUtcDateString(row.untilDate) > from;

  for (const row of rows) {
    if (categoryIds.includes(row.categoryId) || !reaches(row)) continue;

    if (toUtcDateString(row.fromDate) >= from) await row.destroy();
    else await row.update({ untilDate: from });
  }

  for (const categoryId of categoryIds) {
    const [kept, ...absorbed] = rows
      .filter((row) => row.categoryId === categoryId && reaches(row))
      .toSorted((a, b) => toUtcDateString(a.fromDate).localeCompare(toUtcDateString(b.fromDate)));

    if (!kept) {
      await BudgetLineCategories.create({ lineId, categoryId, fromDate: from, untilDate: until });
      continue;
    }

    for (const row of absorbed) await row.destroy();

    const keptFrom = toUtcDateString(kept.fromDate);
    const keptUntil = kept.untilDate === null ? null : toUtcDateString(kept.untilDate);
    const fromDate = keptFrom < from ? keptFrom : from;

    if (fromDate !== keptFrom || keptUntil !== until) {
      await kept.update({ fromDate, untilDate: until });
    }
  }
};

const updateLineImpl = async ({
  userId,
  planId,
  lineId,
  name,
  sortOrder,
  categoryIds,
  effectiveFrom,
}: {
  userId: number;
  planId: RecordId;
  lineId: RecordId;
  name?: string;
  sortOrder?: number;
  categoryIds?: RecordId[];
  effectiveFrom?: string;
}) => {
  const plan = await lockPlan({ planId, userId });
  const { starts, currentStart } = await ensureCurrentPeriods({ plan });

  const line = await findOrThrowNotFound({
    query: BudgetLines.findOne({ where: { id: lineId, planId: plan.id } }),
    message: t({ key: 'budgetPlans.lineNotFound' }),
  });

  if (categoryIds) {
    const from = effectiveFrom ?? currentStart;
    const activeFrom = toUtcDateString(line.activeFrom);
    const activeUntil = line.activeUntil === null ? null : toUtcDateString(line.activeUntil);

    if (!starts.includes(from) || from < activeFrom || (activeUntil !== null && from >= activeUntil)) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.effectiveFromOutsideLifetime' }) });
    }

    await validateLineCategories({ plan, lineId: line.id, categoryIds, range: { from, until: activeUntil } });
    await applyMembership({ lineId: line.id, categoryIds, from, until: activeUntil });
  }

  await line.update(removeUndefinedKeys({ name, sortOrder }));

  const lineCategories = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  return toLineEntry({ line, lineCategories, currentStart });
};

export const updateLine = withTransaction(updateLineImpl);
