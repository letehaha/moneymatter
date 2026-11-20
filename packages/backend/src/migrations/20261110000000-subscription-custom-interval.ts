import { QueryInterface, Transaction } from 'sequelize';

/**
 * Adds the `custom` subscription frequency: every `intervalCount` `intervalUnit`s
 * (e.g. every 30 days) next to the six presets.
 *
 * 1. `Subscriptions.frequency` and `SubscriptionCandidates.detectedFrequency` move from
 *    Postgres ENUMs to VARCHAR(50) guarded by a CHECK on the allowed values, matching the
 *    project's no-DB-enum convention, so a new value needs no ALTER TYPE.
 * 2. Both tables get a nullable step pair. A CHECK ties it to the frequency: `custom`
 *    carries a complete step, a preset carries none. The per-unit count limits live in
 *    the API schema; the CHECK only bounds the count by the largest of them.
 */

const PRESET_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual'] as const;
const FREQUENCIES = [...PRESET_FREQUENCIES, 'custom'] as const;
const INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;
const MAX_INTERVAL_COUNT = 366;

const quoteList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

const TABLES = [
  {
    table: 'Subscriptions',
    frequencyColumn: 'frequency',
    unitColumn: 'intervalUnit',
    countColumn: 'intervalCount',
    enumType: 'enum_Subscriptions_frequency',
    valuesCheck: 'chk_subscriptions_frequency',
    stepCheck: 'chk_subscriptions_custom_interval',
  },
  {
    table: 'SubscriptionCandidates',
    frequencyColumn: 'detectedFrequency',
    unitColumn: 'detectedIntervalUnit',
    countColumn: 'detectedIntervalCount',
    enumType: 'enum_SubscriptionCandidates_detectedFrequency',
    valuesCheck: 'chk_subscription_candidates_detected_frequency',
    stepCheck: 'chk_subscription_candidates_custom_interval',
  },
] as const;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();
    const query = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

    try {
      for (const { table, frequencyColumn, unitColumn, countColumn, enumType, valuesCheck, stepCheck } of TABLES) {
        await query(
          `ALTER TABLE "${table}" ALTER COLUMN "${frequencyColumn}" TYPE VARCHAR(50) USING "${frequencyColumn}"::text;`,
        );
        await query(`DROP TYPE IF EXISTS "${enumType}";`);
        await query(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${valuesCheck}" CHECK ("${frequencyColumn}" IN (${quoteList(FREQUENCIES)}));`,
        );

        await query(`ALTER TABLE "${table}" ADD COLUMN "${unitColumn}" VARCHAR(10) NULL;`);
        await query(`ALTER TABLE "${table}" ADD COLUMN "${countColumn}" INTEGER NULL;`);
        await query(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${stepCheck}" CHECK (
             (
               "${frequencyColumn}" = 'custom'
               AND "${unitColumn}" IN (${quoteList(INTERVAL_UNITS)})
               AND "${countColumn}" BETWEEN 1 AND ${MAX_INTERVAL_COUNT}
             )
             OR (
               "${frequencyColumn}" <> 'custom'
               AND "${unitColumn}" IS NULL
               AND "${countColumn}" IS NULL
             )
           );`,
        );
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  // Fails while any `custom` row exists in either table, since the restored ENUMs
  // cannot represent it: change or delete those rows before reverting.
  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();
    const query = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

    try {
      for (const { table, frequencyColumn, unitColumn, countColumn, enumType, valuesCheck, stepCheck } of TABLES) {
        await query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${stepCheck}";`);
        await query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${valuesCheck}";`);
        await query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${countColumn}";`);
        await query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${unitColumn}";`);

        await query(`CREATE TYPE "${enumType}" AS ENUM(${quoteList(PRESET_FREQUENCIES)});`);
        await query(
          `ALTER TABLE "${table}" ALTER COLUMN "${frequencyColumn}" TYPE "${enumType}" USING "${frequencyColumn}"::"${enumType}";`,
        );
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
