import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

/**
 * Links the extra rows of a multi-account payment to their main row. `SET NULL`, not
 * `CASCADE`: a cascade would remove the legs without the model hooks that move
 * account balances, so the service deletes them explicitly instead.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Transactions',
        'paymentParentId',
        {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'Transactions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction: t },
      );
      await queryInterface.addColumn(
        'Transactions',
        'paymentAmount',
        { type: DataTypes.BIGINT, allowNull: true },
        { transaction: t },
      );
      await queryInterface.addColumn(
        'Transactions',
        'paymentLinkSnapshot',
        { type: DataTypes.JSONB, allowNull: true },
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `CREATE INDEX "transactions_payment_parent_id" ON "Transactions" ("paymentParentId") WHERE "paymentParentId" IS NOT NULL`,
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
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "transactions_payment_parent_id"`, { transaction: t });
      await queryInterface.removeColumn('Transactions', 'paymentLinkSnapshot', { transaction: t });
      await queryInterface.removeColumn('Transactions', 'paymentAmount', { transaction: t });
      await queryInterface.removeColumn('Transactions', 'paymentParentId', { transaction: t });
      await queryInterface.sequelize.query(createRealTransactionsViewSql, { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
