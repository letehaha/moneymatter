import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import BudgetPeriods from '@models/budget-periods.model';
import BudgetPlans from '@models/budget-plans.model';
import { connection } from '@models/connection';
import { QueryTypes } from 'sequelize';

import { FoldActivityRow } from '../fold/fold-plan';

interface RawActivityRow {
  periodId: RecordId;
  categoryId: RecordId;
  /** Cents. SUM over BIGINT returns numeric, which pg hands back as a string. */
  activity: string;
}

const utcInstant = ({ date }: { date: string | Date }): Date => new Date(`${toUtcDateString(date)}T00:00:00.000Z`);

/**
 * Signed cents per period x category, on the stats scope rules plus "the
 * account is in this plan". Expense is negative, income positive, so a line's
 * activity is usually <= 0.
 *
 * ponytail: live fold from epoch on every read; add per-period closing
 * snapshots only if a plan view measurably gets slow.
 */
export const getPlanActivity = async ({
  plan,
  periods,
}: {
  plan: BudgetPlans;
  periods: BudgetPeriods[];
}): Promise<FoldActivityRow[]> => {
  const lastEnd = periods.at(-1)?.endDate;
  if (!lastEnd) return [];

  const rows: RawActivityRow[] = await connection.sequelize.query(
    `
    -- planned-ok: the scope filters planned rows out explicitly, like the stats rules
    WITH scoped AS (
      SELECT t.id, t."time", t."categoryId", t."refAmount", t."transactionType"
      FROM "Transactions" t
      JOIN "BudgetPlanAccounts" pa ON pa."accountId" = t."accountId" AND pa."planId" = :planId
      JOIN "Accounts" a ON a.id = t."accountId" AND a."excludeFromStats" = false AND a."userId" = :ownerId
      WHERE t."isPlanned" = false
        AND t."time" >= :fromUtc AND t."time" < :toUtc
        AND ( t."transferNature" = 'not_transfer'
           OR (t."transferNature" = 'transfer_to_loan' AND t."transactionType" = 'expense') )
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
      SELECT s.id AS "txId", s."time", s."transactionType", s."categoryId",
             s."refAmount" - COALESCE(st.total, 0) AS "refAmount"
      FROM scoped s LEFT JOIN split_totals st ON st."transactionId" = s.id
      WHERE s."refAmount" - COALESCE(st.total, 0) > 0
      UNION ALL
      SELECT s.id, s."time", s."transactionType", sp."categoryId", sp."refAmount"
      FROM scoped s JOIN "TransactionSplits" sp ON sp."transactionId" = s.id
    ),
    attributed AS (
      -- A refund lands in ITS period. On an original this plan counted it takes
      -- that original's category, NULL included, so it can never credit a line
      -- the original never charged. Otherwise it keeps its own category.
      SELECT u."time", u."transactionType", u."refAmount",
             CASE WHEN o.id IS NULL THEN u."categoryId"
                  ELSE COALESCE(osp."categoryId", o."categoryId") END AS "categoryId"
      FROM units u
      LEFT JOIN "RefundTransactions" r ON r."refundTxId" = u."txId"
      LEFT JOIN scoped o ON o.id = r."originalTxId"
      LEFT JOIN "TransactionSplits" osp ON osp.id = r."splitId"
    )
    SELECT p.id AS "periodId", x."categoryId",
           SUM(CASE WHEN x."transactionType" = 'expense' THEN -x."refAmount" ELSE x."refAmount" END) AS "activity"
    FROM attributed x
    JOIN "BudgetPeriods" p
      ON p."planId" = :planId
     AND x."time" >= (p."startDate"::timestamp AT TIME ZONE 'UTC')
     AND x."time" <  (p."endDate"::timestamp   AT TIME ZONE 'UTC')
    WHERE x."categoryId" IS NOT NULL
    GROUP BY p.id, x."categoryId"
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        planId: plan.id,
        ownerId: plan.userId,
        fromUtc: utcInstant({ date: plan.epochDate }),
        toUtc: utcInstant({ date: lastEnd }),
      },
    },
  );

  return rows.map((row) => ({
    periodId: row.periodId,
    categoryId: row.categoryId,
    activity: Number(row.activity),
  }));
};
