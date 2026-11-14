import { QueryInterface } from 'sequelize';

/**
 * Foreign-key columns with no index of their own. Without one, every Transactions delete
 * seq-scans each child table for the FK check, and per-user lookups scan the whole table.
 */
const INDEXES: { name: string; table: string; column: string }[] = [
  { name: 'transaction_tags_transaction_id_idx', table: 'TransactionTags', column: 'transactionId' },
  { name: 'tracker_transactions_transaction_id_idx', table: 'TrackerTransactions', column: 'transactionId' },
  {
    name: 'subscription_transactions_transaction_id_idx',
    table: 'SubscriptionTransactions',
    column: 'transactionId',
  },
  { name: 'subscription_periods_transaction_id_idx', table: 'SubscriptionPeriods', column: 'transactionId' },
  { name: 'portfolio_transfers_transaction_id_idx', table: 'PortfolioTransfers', column: 'transactionId' },
  { name: 'transaction_group_items_transaction_id_idx', table: 'TransactionGroupItems', column: 'transactionId' },
  {
    name: 'transfer_suggestion_dismissals_expense_transaction_id_idx',
    table: 'TransferSuggestionDismissals',
    column: 'expenseTransactionId',
  },
  {
    name: 'transfer_suggestion_dismissals_income_transaction_id_idx',
    table: 'TransferSuggestionDismissals',
    column: 'incomeTransactionId',
  },
  { name: 'categories_user_id_idx', table: 'Categories', column: 'userId' },
  { name: 'users_currencies_user_id_idx', table: 'UsersCurrencies', column: 'userId' },
];

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    for (const { name, table, column } of INDEXES) {
      await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" ("${column}");`);
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    for (const { name } of INDEXES) {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${name}";`);
    }
  },
};
