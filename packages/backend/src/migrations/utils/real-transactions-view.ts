export const REAL_TRANSACTIONS_VIEW = 'real_transactions';

// Migrations older than the soft-delete one must use this: "deletedAt" does not exist when they run.
export const createLegacyRealTransactionsViewSql = `CREATE OR REPLACE VIEW ${REAL_TRANSACTIONS_VIEW} AS SELECT * FROM "Transactions" WHERE "isPlanned" = false;`;

export const dropRealTransactionsViewSql = `DROP VIEW IF EXISTS ${REAL_TRANSACTIONS_VIEW};`;
