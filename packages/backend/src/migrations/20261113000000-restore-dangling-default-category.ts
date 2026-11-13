import { QueryInterface } from 'sequelize';

/**
 * `Users.defaultCategoryId` has no FK constraint, so it can reference a category that is
 * gone, and every transaction created without a category (bank sync, imports, balance
 * adjustments) then fails. Such users get the seeded system "Other" category back.
 *
 * The name is English regardless of the user's locale: the migration cannot resolve it.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      `WITH restored AS (
         INSERT INTO "Categories" ("name", "key", "icon", "color", "type", "userId")
         SELECT 'Other', 'other', 'more-horizontal-20-filled', '#7f8c8d', 'internal', u."id"
           FROM "Users" AS u
          WHERE u."defaultCategoryId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Categories" AS c WHERE c."id" = u."defaultCategoryId")
         RETURNING "id", "userId"
       )
       UPDATE "Users" AS u
          SET "defaultCategoryId" = restored."id"
         FROM restored
        WHERE u."id" = restored."userId";`,
    );
  },

  down: async (): Promise<void> => {},
};
