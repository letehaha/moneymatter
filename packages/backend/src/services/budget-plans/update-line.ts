import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { trackEvent } from '@js/utils/posthog';
import BudgetLineCategories from '@models/budget-line-categories.model';
import { withTransaction } from '@services/common/with-transaction';

import { closeMembershipAt } from './archive-line';
import { covers, toRange } from './date-ranges';
import { findLine, findPlan } from './find-plan';
import { toLineEntry } from './get-plan';
import { endOfGroupSortOrder } from './line-groups';
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
  const reaches = ({ row }: { row: BudgetLineCategories }) =>
    row.untilDate === null || toUtcDateString(row.untilDate) > from;

  for (const row of rows) {
    if (!categoryIds.includes(row.categoryId)) await closeMembershipAt({ row, at: from });
  }

  for (const categoryId of categoryIds) {
    const [kept, ...absorbed] = rows
      .filter((row) => row.categoryId === categoryId && reaches({ row }))
      .toSorted((a, b) => toUtcDateString(a.fromDate).localeCompare(toUtcDateString(b.fromDate)));

    if (!kept) {
      await BudgetLineCategories.create({ lineId, categoryId, fromDate: from, untilDate: until });
      continue;
    }

    for (const row of absorbed) await row.destroy();

    const { from: keptFrom, until: keptUntil } = toRange({ from: kept.fromDate, until: kept.untilDate });
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
  groupId,
  categoryIds,
  effectiveFrom,
}: {
  userId: number;
  planId: RecordId;
  lineId: RecordId;
  name?: string;
  sortOrder?: number;
  /** `null` ungroups the line; a moved line lands last in its new list unless `sortOrder` says otherwise. */
  groupId?: RecordId | null;
  categoryIds?: RecordId[];
  effectiveFrom?: string;
}) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { startsThroughCurrent, currentStart } = await ensureCurrentPeriods({ plan });
  const line = await findLine({ planId: plan.id, lineId });

  if (categoryIds) {
    const from = effectiveFrom ?? currentStart;
    const lifetime = toRange({ from: line.activeFrom, until: line.activeUntil });

    if (!startsThroughCurrent.includes(from) || !covers({ range: lifetime, start: from })) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.effectiveFromOutsideLifetime' }) });
    }

    const topMostIds = await validateLineCategories({
      plan,
      lineId: line.id,
      categoryIds,
      range: { from, until: lifetime.until },
    });
    await applyMembership({ lineId: line.id, categoryIds: topMostIds, from, until: lifetime.until });
    if (lifetime.until !== null) await line.update({ archivedCategoryIds: topMostIds });
  }

  const regroup = groupId !== undefined && groupId !== line.groupId;
  const renamed = name !== undefined && name !== line.name;
  const endOfGroup = regroup ? await endOfGroupSortOrder({ planId: plan.id, groupId }) : undefined;
  await line.update(
    removeUndefinedKeys({ name, groupId: regroup ? groupId : undefined, sortOrder: sortOrder ?? endOfGroup }),
  );

  if (renamed || regroup || categoryIds) {
    trackEvent({
      userId,
      event: 'budget_line_edited',
      properties: { origin: line.origin, renamed, regrouped: regroup, recategorized: categoryIds !== undefined },
    });
  }

  const lineCategories = await BudgetLineCategories.findAll({ where: { lineId: line.id } });
  return toLineEntry({ line, lineCategories, currentStart });
};

export const updateLine = withTransaction(updateLineImpl);
