import { QueryInterface } from 'sequelize';

const TABLE = 'ExchangeRates';
const COLUMN = 'source';
const CHECK_CONSTRAINT = 'ExchangeRates_source_valid';

// Values MUST stay in sync with EXCHANGE_RATE_PROVIDER_TYPE in
// packages/shared/src/types/currencies.ts. Migrations run in plain Node and cannot
// import app code, so the strings are duplicated here.
const PROVIDER_CURRENCY_RATES_API = 'currency-rates-api';
const PROVIDER_FRANKFURTER = 'frankfurter';
const PROVIDER_API_LAYER = 'api-layer';
const PROVIDER_UNKNOWN = 'unknown';

const ALL_PROVIDERS = [PROVIDER_CURRENCY_RATES_API, PROVIDER_API_LAYER, PROVIDER_UNKNOWN] as const;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Drop the existing CHECK so we can both rewrite rows and tighten the
      // allowed set in one transaction.
      await queryInterface.sequelize.query(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${CHECK_CONSTRAINT}";`, {
        transaction,
      });

      // Re-attribute frankfurter-sourced rows. The provider is gone, so leaving
      // the string would only confuse readers and would fail the tightened
      // CHECK constraint below. `unknown` is the honest catch-all – the rate
      // value itself stays unchanged.
      await queryInterface.sequelize.query(
        `UPDATE "${TABLE}" SET "${COLUMN}" = :unknown WHERE "${COLUMN}" = :frankfurter;`,
        {
          transaction,
          replacements: { unknown: PROVIDER_UNKNOWN, frankfurter: PROVIDER_FRANKFURTER },
        },
      );

      // Re-add the CHECK with frankfurter removed.
      const placeholders = ALL_PROVIDERS.map((_, i) => `:p${i}`).join(', ');
      const replacements = Object.fromEntries(ALL_PROVIDERS.map((value, i) => [`p${i}`, value]));
      await queryInterface.sequelize.query(
        `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${CHECK_CONSTRAINT}" CHECK ("${COLUMN}" IN (${placeholders}));`,
        { transaction, replacements },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${CHECK_CONSTRAINT}";`, {
        transaction,
      });

      // Restore the pre-drop CHECK set (with frankfurter). Rows previously
      // relabelled to `unknown` in up() are NOT round-tripped – the original
      // attribution was already destroyed.
      const restoredSet = [...ALL_PROVIDERS, PROVIDER_FRANKFURTER];
      const placeholders = restoredSet.map((_, i) => `:p${i}`).join(', ');
      const replacements = Object.fromEntries(restoredSet.map((value, i) => [`p${i}`, value]));
      await queryInterface.sequelize.query(
        `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${CHECK_CONSTRAINT}" CHECK ("${COLUMN}" IN (${placeholders}));`,
        { transaction, replacements },
      );
    });
  },
};
