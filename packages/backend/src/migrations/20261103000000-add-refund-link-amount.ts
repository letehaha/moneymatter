import { QueryInterface } from 'sequelize';

/**
 * Lets one refund transaction be split across several purchases. `amount` is the link's share in
 * the refund transaction's own currency; NULL means the whole refund transaction.
 *
 * `refundTxId` stops being unique on its own: it is unique per original, and at most one link per
 * refund has a NULL originalTxId. That such a link is the refund's only link is enforced in app
 * code, not by these indexes.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t = await queryInterface.sequelize.transaction();
    try {
      const query = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

      await query(`ALTER TABLE "RefundTransactions" ADD COLUMN "amount" BIGINT NULL;`);
      await query(`
        ALTER TABLE "RefundTransactions"
        ADD CONSTRAINT "RefundTransactions_amount_check" CHECK ("amount" IS NULL OR "amount" > 0);
      `);

      await query(`ALTER TABLE "RefundTransactions" DROP CONSTRAINT IF EXISTS "RefundTransactions_refundTxId_key";`);
      await query(`DROP INDEX IF EXISTS refund_transactions_refund_tx_id;`);
      await query(`DROP INDEX IF EXISTS refund_transactions_refund_tx_id_unique_idx;`);

      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS refund_transactions_refund_tx_original_tx_unique_idx
        ON "RefundTransactions" ("refundTxId", "originalTxId");
      `);
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS refund_transactions_refund_tx_no_original_unique_idx
        ON "RefundTransactions" ("refundTxId") WHERE "originalTxId" IS NULL;
      `);

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  // Restoring UNIQUE(refundTxId) needs one link per refund, so every refund keeps only its
  // earliest link. That loses the other shares and is not reversible. Dropping `amount` also turns
  // every surviving partial link into a whole-refund link.
  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t = await queryInterface.sequelize.transaction();
    try {
      const query = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

      await query(`DROP INDEX IF EXISTS refund_transactions_refund_tx_original_tx_unique_idx;`);
      await query(`DROP INDEX IF EXISTS refund_transactions_refund_tx_no_original_unique_idx;`);

      const [deletedLinks] = (await query(`
        DELETE FROM "RefundTransactions" r
        USING (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY "refundTxId" ORDER BY "createdAt", id) AS rn
          FROM "RefundTransactions"
        ) ranked
        WHERE r.id = ranked.id AND ranked.rn > 1
        RETURNING r."originalTxId";
      `)) as [{ originalTxId: string | null }[], unknown];

      const affectedOriginalIds = Array.from(
        new Set(deletedLinks.map((link) => link.originalTxId).filter((id): id is string => Boolean(id))),
      );
      if (affectedOriginalIds.length) {
        await queryInterface.sequelize.query(
          `
          UPDATE "Transactions" t
          SET "refundLinked" = EXISTS (
            SELECT 1 FROM "RefundTransactions" r
            WHERE r."refundTxId" = t.id OR r."originalTxId" = t.id
          )
          WHERE t.id IN (:ids);
        `,
          { transaction: t, replacements: { ids: affectedOriginalIds } },
        );
      }
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS refund_transactions_refund_tx_id_unique_idx
        ON "RefundTransactions" ("refundTxId");
      `);

      await query(`ALTER TABLE "RefundTransactions" DROP CONSTRAINT IF EXISTS "RefundTransactions_amount_check";`);
      await query(`ALTER TABLE "RefundTransactions" DROP COLUMN IF EXISTS "amount";`);

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
