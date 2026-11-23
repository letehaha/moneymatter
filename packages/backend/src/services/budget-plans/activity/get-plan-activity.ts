import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import BudgetPeriods from '@models/budget-periods.model';
import BudgetPlans from '@models/budget-plans.model';
import { connection } from '@models/connection';
import { excludeFromStatsSql } from '@services/stats/stats-transactions';
import { QueryTypes } from 'sequelize';

import { localMidnight } from '../date-ranges';
import { FoldActivityRow } from '../fold/fold-plan';

interface RawActivityRow {
  periodId: RecordId;
  categoryId: RecordId | null;
  /** Decimal string: a SUM over the DECIMAL ref amounts, which pg hands back as text. */
  activity: string;
}

type ActivityGrouping = { kind: 'period' } | { kind: 'day' } | { kind: 'transaction'; periodId: RecordId };

interface RawRowByGrouping {
  period: RawActivityRow;
  day: RawActivityRow & { dayOffset: number };
  transaction: RawActivityRow & { transactionId: RecordId; time: Date };
}

interface PlanDailyActivityRow extends FoldActivityRow {
  /** Days from the period start, 0 for its first day. */
  dayOffset: number;
}

const queryActivity = async <G extends ActivityGrouping>({
  plan,
  from,
  until,
  grouping,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  from: string | Date;
  until: string | Date;
  /** `transaction` narrows the result to that period and splits it by transaction. */
  grouping: G;
  /** The plan currency's decimals. */
  decimals: number;
  timezone: string;
}): Promise<RawRowByGrouping[G['kind']][]> => {
  const dayOffset = `(x."time" AT TIME ZONE :timezone)::date - p."startDate"`;
  const { select, groupBy } =
    grouping.kind === 'day'
      ? { select: ` ${dayOffset} AS "dayOffset",`, groupBy: `, ${dayOffset}` }
      : grouping.kind === 'transaction'
        ? { select: ` x."txId" AS "transactionId", MAX(x."time") AS "time",`, groupBy: `, x."txId"` }
        : { select: '', groupBy: '' };

  const rows: RawRowByGrouping[G['kind']][] = await connection.sequelize.query(
    `
    WITH scoped AS (
      SELECT t.id, t."time", t."categoryId", t."amount", t."refAmount", t."transactionType"
      FROM real_transactions t
      JOIN "BudgetPlanAccounts" pa ON pa."accountId" = t."accountId" AND pa."planId" = :planId
      JOIN "Accounts" a ON a.id = t."accountId" AND a."excludeFromStats" = false AND a."userId" = :ownerId
      WHERE t."time" >= ${localMidnight({ param: 'from' })} AND t."time" < ${localMidnight({ param: 'until' })}
        AND ${excludeFromStatsSql({ alias: 't' })}
        AND ( t."transferNature" = 'not_transfer'
           OR (t."transferNature" = 'transfer_to_loan' AND t."transactionType" = 'expense')
           OR ( t."time" >= ${localMidnight({ param: 'poolFrom' })} AND NOT EXISTS (
                  SELECT 1 FROM real_transactions o
                  JOIN "BudgetPlanAccounts" opa ON opa."accountId" = o."accountId" AND opa."planId" = :planId
                  JOIN "Accounts" oa ON oa.id = o."accountId" AND oa."excludeFromStats" = false
                  WHERE o."transferId" = t."transferId" AND o.id <> t.id
                ) ) )
        AND ( t."externalData" IS NULL
           OR NOT (t."externalData" @> '{"balanceAdjustment": true}'::jsonb) )
    ),
    split_totals AS (
      SELECT sp."transactionId", SUM(sp."refAmount") AS total
      FROM "TransactionSplits" sp JOIN scoped s ON s.id = sp."transactionId"
      GROUP BY sp."transactionId"
    ),
    units AS (
      -- Splits may sum to LESS than the transaction; the parent keeps the remainder.
      SELECT s.id AS "txId", NULL::uuid AS "splitId", s."time", s."transactionType", s."categoryId",
             s."refAmount" - COALESCE(st.total, 0) AS "refAmount"
      FROM scoped s LEFT JOIN split_totals st ON st."transactionId" = s.id
      WHERE s."refAmount" - COALESCE(st.total, 0) > 0
      UNION ALL
      SELECT s.id, sp.id, s."time", s."transactionType", sp."categoryId", sp."refAmount"
      FROM scoped s JOIN "TransactionSplits" sp ON sp."transactionId" = s.id
    ),
    unit_spans AS (
      SELECT u.*,
             SUM(u."refAmount") OVER (PARTITION BY u."txId" ORDER BY u."splitId" NULLS FIRST) AS "unitEnd",
             NULLIF(SUM(u."refAmount") OVER (PARTITION BY u."txId"), 0) AS "unitsTotal"
      FROM units u
    ),
    link_spans AS (
      -- Rounded once per link at the plan currency decimals, as refundShareRefAmount does, so plan and
      -- stats net the same amount.
      SELECT l.*, SUM(l."share") OVER (PARTITION BY l."refundTxId" ORDER BY l.id) AS "linkEnd"
      FROM (
        SELECT r.id, r."refundTxId", r."originalTxId", r."splitId", r.amount,
               COALESCE(ROUND(s."refAmount" * r.amount / NULLIF(s."amount", 0), :decimals), 0) AS "share"
        FROM "RefundTransactions" r JOIN scoped s ON s.id = r."refundTxId"
      ) l
    ),
    unit_shares AS (
      -- With F(x, y) = ROUND(x * y / total) at those decimals over running unit (x) and link (y) totals, a
      -- cell is F's difference over its box: each link's cells sum to its share, and no unit gives more than it holds.
      SELECT u."txId", u."splitId", u."time", u."transactionType", u."categoryId", u."refAmount",
             r."originalTxId", r."splitId" AS "refundSplitId",
             CASE WHEN r.amount IS NULL THEN u."refAmount"
                  ELSE COALESCE(
                      ROUND(u."unitEnd" * r."linkEnd" / u."unitsTotal", :decimals)
                    - ROUND((u."unitEnd" - u."refAmount") * r."linkEnd" / u."unitsTotal", :decimals)
                    - ROUND(u."unitEnd" * (r."linkEnd" - r."share") / u."unitsTotal", :decimals)
                    + ROUND((u."unitEnd" - u."refAmount") * (r."linkEnd" - r."share") / u."unitsTotal", :decimals),
                  0) END AS "shareRefAmount",
             r.amount IS NOT NULL AS "isPartial"
      FROM unit_spans u
      LEFT JOIN link_spans r ON r."refundTxId" = u."txId"
    ),
    attributed AS (
      -- A refund lands in ITS period. On an original this plan counted it takes
      -- that original's category, NULL included, so it can never credit a line
      -- the original never charged. Otherwise it keeps its own category.
      SELECT u."txId", u."time", u."transactionType", u."shareRefAmount" AS "refAmount",
             CASE WHEN o.id IS NULL THEN u."categoryId"
                  ELSE COALESCE(osp."categoryId", o."categoryId") END AS "categoryId"
      FROM unit_shares u
      LEFT JOIN scoped o ON o.id = u."originalTxId"
      LEFT JOIN "TransactionSplits" osp ON osp.id = u."refundSplitId"
      UNION ALL
      -- Whatever the shares leave unassigned stays under the refund's own category.
      SELECT u."txId", u."time", u."transactionType", u."refAmount" - SUM(u."shareRefAmount"), u."categoryId"
      FROM unit_shares u
      WHERE u."isPartial"
      GROUP BY u."txId", u."splitId", u."time", u."transactionType", u."categoryId", u."refAmount"
      HAVING u."refAmount" > SUM(u."shareRefAmount")
    )
    SELECT p.id AS "periodId", x."categoryId",${select}
           SUM(CASE WHEN x."transactionType" = 'expense' THEN -x."refAmount" ELSE x."refAmount" END) AS "activity"
    FROM attributed x
    JOIN "BudgetPeriods" p
      ON p."planId" = :planId${grouping.kind === 'transaction' ? ' AND p.id = :periodId' : ''}
     AND x."time" >= (p."startDate"::timestamp AT TIME ZONE :timezone)
     AND x."time" <  (p."endDate"::timestamp   AT TIME ZONE :timezone)
    -- A NULL pool start makes the comparison NULL, which keeps the row out.
    WHERE x."categoryId" IS NOT NULL OR x."time" >= ${localMidnight({ param: 'poolFrom' })}
    GROUP BY p.id, x."categoryId"${groupBy}
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        planId: plan.id,
        ownerId: plan.userId,
        from: toUtcDateString(from),
        until: toUtcDateString(until),
        poolFrom: plan.poolFrom ? toUtcDateString(plan.poolFrom) : null,
        timezone,
        decimals,
        ...(grouping.kind === 'transaction' ? { periodId: grouping.periodId } : {}),
      },
    },
  );
  return rows;
};

/**
 * Signed minor units (at `decimals`) per period x category, on the stats scope rules plus "the
 * account is in this plan". Expense is negative, income positive, so a line's
 * activity is usually <= 0. From `poolFrom` on, transfers crossing the plan
 * boundary and uncategorised money (`categoryId` NULL) count too; before it,
 * and on a plan without a pool, both stay out.
 *
 * ponytail: live fold from epoch on every read; add per-period closing
 * snapshots only if a plan view measurably gets slow.
 */
export const getPlanActivity = async ({
  plan,
  periods,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  periods: BudgetPeriods[];
  /** The plan currency's decimals. */
  decimals: number;
  timezone: string;
}): Promise<FoldActivityRow[]> => {
  const lastEnd = periods.at(-1)?.endDate;
  if (!lastEnd) return [];

  const rows = await queryActivity({
    plan,
    from: plan.epochDate,
    until: lastEnd,
    grouping: { kind: 'period' },
    decimals,
    timezone,
  });
  return rows.map((row) => ({
    periodId: row.periodId,
    categoryId: row.categoryId,
    activity: Money.fromDecimal(row.activity).toMinorUnits({ decimals }),
  }));
};

/**
 * `getPlanActivity` for contiguous `periods`, also split by day. Only their own
 * transactions are scanned, so a refund of an original from before them keeps
 * its own category.
 */
export const getPlanDailyActivity = async ({
  plan,
  periods,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  periods: BudgetPeriods[];
  /** The plan currency's decimals. */
  decimals: number;
  timezone: string;
}): Promise<PlanDailyActivityRow[]> => {
  const first = periods[0];
  const last = periods.at(-1);
  if (!first || !last) return [];

  const epoch = toUtcDateString(plan.epochDate);
  const start = toUtcDateString(first.startDate);
  const rows = await queryActivity({
    plan,
    from: start > epoch ? start : epoch,
    until: last.endDate,
    grouping: { kind: 'day' },
    decimals,
    timezone,
  });
  return rows.map((row) => ({
    periodId: row.periodId,
    categoryId: row.categoryId,
    activity: Money.fromDecimal(row.activity).toMinorUnits({ decimals }),
    dayOffset: Number(row.dayOffset),
  }));
};

interface PlanTransactionActivityRow extends FoldActivityRow {
  transactionId: RecordId;
  time: Date;
}

/**
 * `getPlanActivity` rows of one period, split by the transaction that produced them.
 * ponytail: the scan stops at the period end, so a refund dated before an original
 * from a later period keeps its own category here; widen `until` if that case matters.
 */
export const getPlanPeriodTransactionActivity = async ({
  plan,
  period,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  period: BudgetPeriods;
  /** The plan currency's decimals. */
  decimals: number;
  timezone: string;
}): Promise<PlanTransactionActivityRow[]> => {
  const rows = await queryActivity({
    plan,
    from: plan.epochDate,
    until: period.endDate,
    grouping: { kind: 'transaction', periodId: period.id },
    decimals,
    timezone,
  });
  return rows.map((row) => ({
    periodId: row.periodId,
    categoryId: row.categoryId,
    activity: Money.fromDecimal(row.activity).toMinorUnits({ decimals }),
    transactionId: row.transactionId,
    time: new Date(row.time),
  }));
};
