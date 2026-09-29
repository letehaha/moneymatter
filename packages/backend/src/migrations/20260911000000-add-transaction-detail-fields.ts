import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { createLegacyRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

const COLUMNS = {
  externalUrl: { type: DataTypes.STRING(2048), allowNull: true },
  externalReference: { type: DataTypes.STRING(255), allowNull: true },
  location: { type: DataTypes.JSONB, allowNull: true },
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      for (const [name, definition] of Object.entries(COLUMNS)) {
        await queryInterface.addColumn('Transactions', name, definition, { transaction: t });
      }
      await queryInterface.sequelize.query(createLegacyRealTransactionsViewSql, { transaction: t });

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
