import { QueryInterface, Transaction } from 'sequelize';

/**
 * Dated, source-aware user exchange rates.
 *
 * - "UserExchangeRates"."effectiveDate" is the calendar day a rate starts to apply. It joins the
 *   primary key in place of the "date" timestamp (the moment the row was written), so a pair can
 *   hold one rate per day. A row that exists already gets the UTC day of its "date".
 * - "UserExchangeRates"."source" says where a rate came from: 'manual' for every row that exists.
 *
 * A pair never had more than one row (an edit rewrote it), so the new key cannot collide. If two
 * rows of a pair do share a day, the one written last is kept.
 *
 * `down` keeps only the row with the latest "effectiveDate" for each pair, because the old key and
 * the old lookups assume one rate per pair. Earlier dated rates of a pair are lost.
 */

const PRIMARY_KEY_NAME = 'UserExchangeRates_pkey';

const dropPrimaryKeySql = `
  DO $$
  DECLARE pk TEXT;
  BEGIN
    SELECT conname INTO pk FROM pg_constraint
     WHERE conrelid = '"UserExchangeRates"'::regclass AND contype = 'p';
    IF pk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE "UserExchangeRates" DROP CONSTRAINT %I', pk);
    END IF;
  END $$;`;

const upStatements = (): string[] => [
  `ALTER TABLE "UserExchangeRates"
     ADD COLUMN "effectiveDate" DATE,
     ADD COLUMN "source" VARCHAR(32) NOT NULL DEFAULT 'manual';`,
  // The same rule the backup restore applies to an archive written before this column existed.
  `UPDATE "UserExchangeRates" SET "effectiveDate" = ("date" AT TIME ZONE 'UTC')::date;`,
  `DELETE FROM "UserExchangeRates" older
     USING "UserExchangeRates" newer
    WHERE older."userId" = newer."userId"
      AND older."baseCode" = newer."baseCode"
      AND older."quoteCode" = newer."quoteCode"
      AND older."effectiveDate" = newer."effectiveDate"
      AND older."date" < newer."date";`,
  `ALTER TABLE "UserExchangeRates" ALTER COLUMN "effectiveDate" SET NOT NULL;`,
  dropPrimaryKeySql,
  `ALTER TABLE "UserExchangeRates"
     ADD CONSTRAINT "${PRIMARY_KEY_NAME}" PRIMARY KEY ("userId", "baseCode", "quoteCode", "effectiveDate");`,
];

const downStatements = (): string[] => [
  `DELETE FROM "UserExchangeRates" older
     USING "UserExchangeRates" newer
    WHERE older."userId" = newer."userId"
      AND older."baseCode" = newer."baseCode"
      AND older."quoteCode" = newer."quoteCode"
      AND (older."effectiveDate" < newer."effectiveDate"
           OR (older."effectiveDate" = newer."effectiveDate" AND older."date" < newer."date"));`,
  dropPrimaryKeySql,
  `ALTER TABLE "UserExchangeRates"
     ADD CONSTRAINT "${PRIMARY_KEY_NAME}" PRIMARY KEY ("userId", "baseCode", "quoteCode", "date");`,
  `ALTER TABLE "UserExchangeRates" DROP COLUMN "source", DROP COLUMN "effectiveDate";`,
];

const runMigration = async ({
  queryInterface,
  direction,
}: {
  queryInterface: QueryInterface;
  direction: 'up' | 'down';
}): Promise<void> => {
  const t: Transaction = await queryInterface.sequelize.transaction();

  try {
    for (const sql of direction === 'up' ? upStatements() : downStatements()) {
      await queryInterface.sequelize.query(sql, { transaction: t });
    }

    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> => runMigration({ queryInterface, direction: 'up' }),
  down: (queryInterface: QueryInterface): Promise<void> => runMigration({ queryInterface, direction: 'down' }),
};
