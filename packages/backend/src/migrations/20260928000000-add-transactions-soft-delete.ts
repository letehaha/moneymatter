import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { createLegacyRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

const COLUMNS = {
  deletedAt: { type: DataTypes.DATE, allowNull: true },
  mergedIntoId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'Transactions', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  },
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      for (const [name, definition] of Object.entries(COLUMNS)) {
        await queryInterface.addColumn('Transactions', name, definition, { transaction: t });
      }
      await queryInterface.sequelize.query(
        'CREATE INDEX transactions_merged_into_id_idx ON "Transactions" ("mergedIntoId") WHERE "mergedIntoId" IS NOT NULL;',
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE "Transactions" ADD CONSTRAINT transactions_merged_into_requires_deleted CHECK ("mergedIntoId" IS NULL OR "deletedAt" IS NOT NULL);',
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`,
        { transaction: t },
      );

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
      await queryInterface.sequelize.query(
        'ALTER TABLE "Transactions" DROP CONSTRAINT transactions_merged_into_requires_deleted;',
        { transaction: t },
      );
      for (const name of Object.keys(COLUMNS)) {
        await queryInterface.removeColumn('Transactions', name, { transaction: t });
      }
      await queryInterface.sequelize.query(createLegacyRealTransactionsViewSql, { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
