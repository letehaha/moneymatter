import { QueryInterface } from 'sequelize';

import { createLegacyRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Planned-free view of "Transactions" for raw SQL, which no TS-level boundary can police.
 * Postgres pins a SELECT * view's column list at creation, so migrations touching "Transactions"
 * must maintain it: one adding a column re-creates the `real_transactions` view at the end with
 * the current view SQL written inline, or the column is absent here. ALTER COLUMN ... TYPE /
 * DROP COLUMN are refused outright until `dropRealTransactionsViewSql` from
 * ./utils/real-transactions-view runs first, and
 * models/transactions-query/real-transactions-view-columns.e2e.ts fails when an added column
 * goes missing here.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(createLegacyRealTransactionsViewSql);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(dropRealTransactionsViewSql);
  },
};
