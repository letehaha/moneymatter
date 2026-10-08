import type { PlannedSummaryEntry, RecordId } from '@bt/shared/types';
import { centsToApiDecimal } from '@common/types/money';
import { connection } from '@models/connection';
import { QueryTypes } from 'sequelize';

interface RawSummaryRow {
  accountId: RecordId;
  currencyCode: string;
  plannedDelta: string | null;
  refPlannedDelta: string | null;
  count: string;
  latestTime: Date;
}

/** Scoped to the caller's own rows: planned transactions are owner-only, so an account
 *  shared with the caller has nothing to contribute. Archived accounts stay in. */
export const getPlannedSummary = async ({ userId }: { userId: number }): Promise<PlannedSummaryEntry[]> => {
  const rows: RawSummaryRow[] = await connection.sequelize.query(
    // planned-ok: the summary is about plans, so it reads the base table on purpose
    `
    SELECT "accountId",
           "currencyCode",
           SUM(CASE WHEN "transactionType" = 'expense' THEN -"amount" ELSE "amount" END) AS "plannedDelta",
           SUM(CASE WHEN "transactionType" = 'expense' THEN -"refAmount" ELSE "refAmount" END) AS "refPlannedDelta",
           COUNT(*) AS "count",
           MAX("time") AS "latestTime"
      FROM "Transactions"
     WHERE "userId" = :userId
       AND "isPlanned" = true
     GROUP BY "accountId", "currencyCode"
     ORDER BY "accountId"
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { userId },
    },
  );

  return rows.map((row) => ({
    accountId: row.accountId,
    currencyCode: row.currencyCode,
    plannedDelta: centsToApiDecimal(Number(row.plannedDelta ?? 0)),
    refPlannedDelta: centsToApiDecimal(Number(row.refPlannedDelta ?? 0)),
    count: Number(row.count ?? 0),
    latestTime: new Date(row.latestTime).toISOString(),
  }));
};
