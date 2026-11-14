import { QueryInterface } from 'sequelize';

/**
 * Dropping the INTEGER `transactionId` column in the UUID primary-key migration also dropped this
 * index, leaving only the `(tagId, transactionId)` primary key, which can't serve lookups by
 * transaction (tag filters, tag includes, the cascade on transaction delete).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS "transaction_tags_transaction_id_idx" ON "TransactionTags" ("transactionId");`,
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "transaction_tags_transaction_id_idx";`);
  },
};
