import { QueryInterface, Transaction } from 'sequelize';

/**
 * Dated, source-aware user exchange rates.
 *
 * - "UserExchangeRates"."effectiveDate" is the calendar day a rate starts to apply. It joins the
 *   primary key in place of the "date" timestamp (the moment the row was written), so a pair can
 *   hold one rate per day. A row that exists already gets the UTC day of its "date".
 * - "UserExchangeRates"."source" says where a rate came from: 'manual' for every row that exists,
 *   except the sole rate of a custom currency, which is the one it was created with: 'initial'.
 * - A custom currency keeps only its own rates (custom to ISO); the other direction is their inverse,
 *   so the rows quoted in a custom currency are dropped. `down` leaves them out: the old lookup
 *   derives the inverse when the exact row is missing.
 *
 * - "UsersCurrencies"."rateSource" says where the user's rates for a custom currency come from, and
 *   "rateSourceConfig" holds the settings of that source. Every currency starts on 'manual'; an ISO
 *   currency stays there, its live-rate flag picks between the market and the user's own rate.
 *   "rateSourceHeadersEncrypted" holds the request headers of an HTTP source (they usually carry an
 *   API key) as one encrypted blob, kept apart from the config so that no ordinary read returns it.
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
  `DELETE FROM "UserExchangeRates" stored
     USING "Currencies" currency
    WHERE currency."code" = stored."quoteCode" AND currency."isCustom";`,
  `UPDATE "UserExchangeRates" stored SET "source" = 'initial'
     FROM "Currencies" currency
    WHERE currency."code" = stored."baseCode" AND currency."isCustom"
      AND NOT EXISTS (
        SELECT 1 FROM "UserExchangeRates" other
         WHERE other."userId" = stored."userId" AND other."baseCode" = stored."baseCode"
           AND (other."quoteCode", other."effectiveDate") <> (stored."quoteCode", stored."effectiveDate"));`,
  `ALTER TABLE "UsersCurrencies"
     ADD COLUMN "rateSource" VARCHAR(16) NOT NULL DEFAULT 'manual',
     ADD COLUMN "rateSourceConfig" JSONB,
     ADD COLUMN "rateSourceHeadersEncrypted" TEXT;`,
];

const downStatements = (): string[] => [
  `ALTER TABLE "UsersCurrencies"
     DROP COLUMN "rateSourceHeadersEncrypted", DROP COLUMN "rateSourceConfig", DROP COLUMN "rateSource";`,
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
