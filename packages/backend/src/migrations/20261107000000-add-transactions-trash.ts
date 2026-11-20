import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

/**
 * `deletionReason` tells Trash rows apart from rows hidden by reconciliation, which share
 * `deletedAt`. Every row deleted before this migration came from reconciliation.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Transactions',
        'deletionReason',
        { type: DataTypes.STRING(20), allowNull: true },
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Transactions" SET "deletionReason" = 'reconciliation' WHERE "deletedAt" IS NOT NULL`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "Transactions" ADD CONSTRAINT "transactions_deletion_reason_check" CHECK ("deletedAt" IS NULL OR "deletionReason" IN ('trash', 'reconciliation'))`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `CREATE INDEX "transactions_trash_deleted_at_idx" ON "Transactions" ("deletedAt") WHERE "deletionReason" = 'trash'`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(createRealTransactionsViewSql, { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(dropRealTransactionsViewSql, { transaction: t });
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "transactions_trash_deleted_at_idx"`, {
        transaction: t,
      });
      await queryInterface.sequelize.query(
        `ALTER TABLE "Transactions" DROP CONSTRAINT IF EXISTS "transactions_deletion_reason_check"`,
        { transaction: t },
      );
      // Without the column these would read as reconciliation removals; their balance is already reversed.
      await queryInterface.sequelize.query(`DELETE FROM "Transactions" WHERE "deletionReason" = 'trash'`, {
        transaction: t,
      });
      await queryInterface.removeColumn('Transactions', 'deletionReason', { transaction: t });
      await queryInterface.sequelize.query(createRealTransactionsViewSql, { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
