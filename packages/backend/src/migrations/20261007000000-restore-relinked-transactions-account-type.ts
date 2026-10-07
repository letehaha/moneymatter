import { QueryInterface } from 'sequelize';

// Bank-synced rows on an account that was unlinked and linked back to the same
// provider. `originalSource.importedFrom` holds the provider type, and every
// provider type string equals its account type string. `down` resets every
// row matching the predicate, including rows a relink retyped after `up` ran.
const RELINKED_ROWS = `
  a.id = t."accountId"
  AND a.type <> 'system'
  AND t."isPlanned" = false
  AND t."externalData"#>>'{originalSource,importedFrom}' = a.type
  AND t."externalData"->'importDetails' IS NULL
`;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`
      UPDATE "Transactions" t
      SET "accountType" = a.type
      FROM "Accounts" a
      WHERE ${RELINKED_ROWS} AND t."accountType" = 'system';
    `);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`
      UPDATE "Transactions" t
      SET "accountType" = 'system'
      FROM "Accounts" a
      WHERE ${RELINKED_ROWS} AND t."accountType" = a.type;
    `);
  },
};
