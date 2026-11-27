import { QueryInterface } from 'sequelize';

/**
 * Data repair for venture deals.
 *
 * 1. Soft-deleted deals kept their event links, so the linked transactions stayed
 *    `transfer_to_venture`. Restore each one's snapshotted `transferNature` and drop the link.
 *    `refAmount` / `refCurrencyCode` keep the base-currency restamp done at link time: raw SQL
 *    skips the balance hooks a ref change needs.
 * 2. Hard-deleted deals cascaded the links away with their snapshot. A `transfer_to_venture`
 *    transaction without a link row goes back to `not_transfer`, the nature nearly every
 *    linked transaction had.
 * 3. `entryFee` derived as principal x pct was stored unrounded. Round it half-up to the
 *    deal currency's decimals (the user's override for a custom code).
 * 4. A writedown that leaves value no longer counts as a partial exit. Deals whose only
 *    exit-like events are such writedowns go back to `outstanding`.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
          UPDATE "Transactions" AS t
          SET "transferNature" = COALESCE(
            l."metaData"->'originalTransactionState'->>'transferNature',
            'not_transfer'
          )
          FROM "VentureEventLinks" AS l
          JOIN "VentureEvents" AS e ON e."id" = l."ventureEventId"
          JOIN "VentureDeals" AS d ON d."id" = e."dealId"
          WHERE l."transactionId" = t."id"
            AND d."deletedAt" IS NOT NULL;
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
          DELETE FROM "VentureEventLinks" AS l
          USING "VentureEvents" AS e, "VentureDeals" AS d
          WHERE e."id" = l."ventureEventId"
            AND d."id" = e."dealId"
            AND d."deletedAt" IS NOT NULL;
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
          UPDATE "Transactions" AS t
          SET "transferNature" = 'not_transfer'
          WHERE t."transferNature" = 'transfer_to_venture'
            AND NOT EXISTS (SELECT 1 FROM "VentureEventLinks" AS l WHERE l."transactionId" = t."id");
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
          UPDATE "VentureDeals" AS d
          SET "entryFee" = ROUND(d."entryFee", p."decimals")
          FROM (
            SELECT d2."id",
              CASE WHEN c."isCustom" THEN uc."decimalsOverride" ELSE c."digits" END AS "decimals"
            FROM "VentureDeals" AS d2
            JOIN "Currencies" AS c ON c."code" = d2."currencyCode"
            LEFT JOIN "UsersCurrencies" AS uc
              ON uc."userId" = d2."userId" AND uc."currencyCode" = d2."currencyCode"
          ) AS p
          WHERE p."id" = d."id"
            AND p."decimals" IS NOT NULL
            AND d."entryFee" <> ROUND(d."entryFee", p."decimals");
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
          UPDATE "VentureDeals" AS d
          SET "status" = 'outstanding'
          WHERE d."status" = 'partial_exit'
            AND EXISTS (
              SELECT 1 FROM "VentureEvents" AS e
              WHERE e."dealId" = d."id" AND e."type" = 'writedown' AND ABS(e."navAfter") > 0.0000000001
            )
            AND NOT EXISTS (
              SELECT 1 FROM "VentureEvents" AS e
              WHERE e."dealId" = d."id"
                AND (e."type" IN ('distribution', 'exit')
                  OR (e."type" = 'writedown' AND ABS(e."navAfter") <= 0.0000000001))
            );
        `,
        { transaction },
      );
    });
  },

  down: async (): Promise<void> => {
    // Irreversible data repair: the pre-repair values are not kept.
  },
};
