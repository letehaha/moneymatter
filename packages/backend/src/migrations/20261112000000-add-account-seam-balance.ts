import { QueryInterface } from 'sequelize';

/**
 * `seamBalance` is the native balance, in cents, at the start of the UTC day a manual
 * account was linked to a bank feed. NULL means the account has no seam.
 *
 * Backfill: initialBalance + Σ signed(real rows dated before the link day). Accounts still
 * waiting for their deferred absorb, or with an unreadable `linkedAt`, are left NULL.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t = await queryInterface.sequelize.transaction();
    try {
      const query = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

      await query(`ALTER TABLE "Accounts" ADD COLUMN "seamBalance" BIGINT NULL;`);
      await query(`
        ALTER TABLE "Accounts" ADD CONSTRAINT "Accounts_seamBalance_not_system"
        CHECK ("seamBalance" IS NULL OR "type" <> 'system');
      `);

      await query(`
        UPDATE "Accounts" a
        SET "seamBalance" = a."initialBalance" + COALESCE((
          SELECT SUM(CASE WHEN rt."transactionType" = 'income' THEN rt."amount" ELSE -rt."amount" END)
          FROM real_transactions rt
          WHERE rt."accountId" = a."id"
            AND rt."time" < (date_trunc('day', (a."externalData"->'bankConnection'->>'linkedAt')::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        ), 0)
        WHERE a."type" <> 'system'
          AND a."externalData"->'bankConnection'->>'linkingStrategy' = 'forward-only'
          AND a."externalData"->'bankConnection'->>'linkedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          AND COALESCE((a."externalData"->'bankConnection'->'balanceReconciliation'->>'pendingAbsorb')::boolean, false) = false;
      `);

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "Accounts" DROP CONSTRAINT IF EXISTS "Accounts_seamBalance_not_system";`,
    );
    await queryInterface.sequelize.query(`ALTER TABLE "Accounts" DROP COLUMN IF EXISTS "seamBalance";`);
  },
};
