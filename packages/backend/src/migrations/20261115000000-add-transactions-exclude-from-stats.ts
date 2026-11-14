import { DataTypes, QueryInterface, Transaction } from 'sequelize';

import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

/**
 * A reporting opt-out: the row stays in the ledger, counts toward balances and shows up in the
 * transaction list, but the reports skip it. `defaultValue` mirrors the model, which needs its own
 * default for backup restore to accept an archive that omits the column.
 *
 * The view is rebuilt at the end: Postgres freezes a view's column list when it is created, so the
 * reports reading through `real_transactions` would not see the new column.
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
