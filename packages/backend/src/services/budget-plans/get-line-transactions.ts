import { BudgetPlanLineTransactions, RecordId } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { toUtcDateString, toZonedDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { getTransactionsByIds } from '@services/transactions/get-by-ids';

import { getPlanPeriodTransactionActivity } from './activity/get-plan-activity';
import { findPlan } from './find-plan';
import { ensurePeriods } from './periods/ensure-periods';
import { loadLineOwnerResolver } from './validate-line-categories';

type LineTransactions = BudgetPlanLineTransactions<Awaited<ReturnType<typeof getTransactionsByIds>>[number]>;

/**
 * The transactions whose activity the fold credits to the line in the period,
 * newest first. A split shows on every line one of its parts lands on.
 */
export const getLineTransactions = async ({
  userId,
  planId,
  periodId,
  lineId,
  limit,
  timezone,
}: {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  lineId: RecordId;
  limit: number;
  timezone: string;
}): Promise<LineTransactions> => {
  const plan = await findPlan({ planId, userId });

  const today = toZonedDateString({ date: new Date(), timezone });
  const period = (await ensurePeriods({ plan, today })).find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  const decimals = await getCurrencyDecimals({ userId: plan.userId, code: plan.currencyCode });
  const [{ lines, ownerOf }, rows] = await Promise.all([
    loadLineOwnerResolver({ plan, start: toUtcDateString(period.startDate) }),
    getPlanPeriodTransactionActivity({ plan, period, decimals, timezone }),
  ]);
  if (!lines.some((line) => line.id === lineId)) {
    throw new NotFoundError({ message: t({ key: 'budgetPlans.lineNotFound' }) });
  }

  const byTransaction = new Map<RecordId, { time: Date; activity: number }>();
  for (const row of rows) {
    if (row.categoryId === null || ownerOf(row.categoryId) !== lineId) continue;
    const entry = byTransaction.get(row.transactionId) ?? { time: row.time, activity: 0 };
    entry.activity += row.activity;
    byTransaction.set(row.transactionId, entry);
  }

  // A refund link can leave a zero share under this line; it moves no money here.
  const ids = [...byTransaction.entries()]
    .filter(([, entry]) => entry.activity !== 0)
    .toSorted(([idA, a], [idB, b]) => b.time.getTime() - a.time.getTime() || idB.localeCompare(idA))
    .map(([id]) => id);

  const page = ids.slice(0, limit);
  const fetched = new Map((await getTransactionsByIds({ userId, ids: page })).map((tx) => [tx.id, tx]));
  const transactions = page.flatMap((id) => fetched.get(id) ?? []);

  // ponytail: only this page's dropped rows leave `total`; drops past it still count.
  return { total: ids.length - (page.length - transactions.length), transactions };
};
