import { QueryInterface, QueryTypes } from 'sequelize';

/**
 * Drops shared logo-cache rows the resolver created from a non-matching top search hit
 * (e.g. "phone" -> phone.com), so later lookups of those names go through the exact-name rule.
 * Only the cache changes: payees and subscriptions keep the logo they already show.
 *
 * Frozen copy of `normalizePayeeName` as of this migration.
 */
const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const rows = await queryInterface.sequelize.query<{ id: string; normalizedName: string; brandName: string }>(
        `SELECT "id", "normalizedName", "brandName" FROM "BrandLogos"
          WHERE "source" = 'logodev' AND "brandName" IS NOT NULL;`,
        { type: QueryTypes.SELECT, transaction },
      );

      const fuzzyIds = rows.filter((row) => normalize(row.brandName) !== row.normalizedName).map((row) => row.id);
      if (!fuzzyIds.length) return;

      await queryInterface.sequelize.query(`DELETE FROM "BrandLogos" WHERE "id" IN (:fuzzyIds);`, {
        replacements: { fuzzyIds },
        transaction,
      });
    });
  },

  down: async (): Promise<void> => {},
};
