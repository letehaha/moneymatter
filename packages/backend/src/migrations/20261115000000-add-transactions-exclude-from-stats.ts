import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

/**
 * The view is rebuilt because Postgres freezes a view's column list at creation, so reports reading
 * through `real_transactions` would not see the new column.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Transactions',
        'excludeFromStats',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
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
      await queryInterface.removeColumn('Transactions', 'excludeFromStats', { transaction: t });
      await queryInterface.sequelize.query(createRealTransactionsViewSql, { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
