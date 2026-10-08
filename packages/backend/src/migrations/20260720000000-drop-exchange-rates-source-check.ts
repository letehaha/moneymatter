import { QueryInterface } from 'sequelize';

const TABLE = 'ExchangeRates';
const COLUMN = 'source';
const CHECK_CONSTRAINT = 'ExchangeRates_source_valid';

// Values MUST stay in sync with EXCHANGE_RATE_PROVIDER_TYPE in
// packages/shared/src/types/currencies.ts. Migrations run in plain Node and cannot
// import app code, so the strings are duplicated here. Only used by down().
const PROVIDER_CURRENCY_RATES_API = 'currency-rates-api';
const PROVIDER_API_LAYER = 'api-layer';
const PROVIDER_UNKNOWN = 'unknown';

// The set restored by down() — the whitelist that existed before this migration.
const PRIOR_PROVIDERS = [PROVIDER_CURRENCY_RATES_API, PROVIDER_API_LAYER, PROVIDER_UNKNOWN] as const;

/**
 * Drop the DB-level whitelist on `ExchangeRates.source`.
 *
 * The column stays a `VARCHAR(32) NOT NULL DEFAULT 'unknown'`; only the CHECK
 * constraint that enumerated the allowed provider strings goes away. That
 * whitelist forced a new migration every time a rate provider was added — the
 * TypeScript enum `EXCHANGE_RATE_PROVIDER_TYPE` is now the single source of
 * truth for valid sources, and adding a provider is a code-only change.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${CHECK_CONSTRAINT}";`);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Any source outside the pre-migration whitelist (e.g. providers added
      // after the constraint was dropped) would violate the restored CHECK, so
      // relabel them to the honest catch-all first. The rate value is untouched.
      const placeholders = PRIOR_PROVIDERS.map((_, i) => `:p${i}`).join(', ');
      const replacements = Object.fromEntries(PRIOR_PROVIDERS.map((value, i) => [`p${i}`, value]));
      await queryInterface.sequelize.query(
        `UPDATE "${TABLE}" SET "${COLUMN}" = :unknown WHERE "${COLUMN}" NOT IN (${placeholders});`,
        { transaction, replacements: { ...replacements, unknown: PROVIDER_UNKNOWN } },
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${CHECK_CONSTRAINT}" CHECK ("${COLUMN}" IN (${placeholders}));`,
        { transaction, replacements },
      );
    });
  },
};
