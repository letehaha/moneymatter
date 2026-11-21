import { Transaction, QueryInterface } from 'sequelize';

// The frozen snapshot of the column lists: this migration must not read the live list, which can grow.
import {
  CURRENCY_CODE_COLUMNS_20261120 as CURRENCY_CODE_COLUMNS,
  CURRENCY_CODE_MAX_LENGTH_20261120 as CURRENCY_CODE_MAX_LENGTH,
  ISO_CURRENCY_CODE_LENGTH_20261120 as ISO_CURRENCY_CODE_LENGTH,
} from './utils/currency-code-columns-20261120';
import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Schema for per-user custom currencies.
 *
 * - "Currencies" gains "isCustom"; "number" (the ISO numeric code) becomes nullable, because a
 *   custom row has none. A check keeps it required on every row that is not custom.
 * - "UsersCurrencies" gains "nameOverride", "symbolOverride", "decimalsOverride" (0 to 8,
 *   `MAX_CURRENCY_DECIMALS`) and "logoDomain", "logoInitials", "logoColor", "logoIcon" and
 *   "logoImageId": a custom code's definition is per user.
 * - The currency-code columns listed in the frozen `utils/currency-code-columns-20261120.ts` widen from
 *   varchar(3) to varchar(16). Postgres rebuilds the foreign keys that reference
 *   "Currencies"."code" when it changes the type, so no constraint is dropped by hand.
 *
 * `real_transactions` is `SELECT * FROM "Transactions"`, so it is dropped before the column types
 * change and recreated afterwards.
 *
 * `down` refuses to run while a custom currency or a code longer than three characters exists,
 * because narrowing the columns would otherwise fail halfway. Once none exists it reverses every
 * change. The overrides on "UsersCurrencies" are dropped with their columns.
 */

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

const quote = (identifier: string): string => `"${identifier}"`;

const countSql = ({ table, where }: { table: string; where: string }): string =>
  `SELECT count(*)::int AS count FROM ${quote(table)} WHERE ${where}`;

const upStatements = (): string[] => [
  dropRealTransactionsViewSql,

  `ALTER TABLE "Currencies"
     ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false,
     ALTER COLUMN "number" DROP NOT NULL;`,
  `ALTER TABLE "Currencies"
     ADD CONSTRAINT "Currencies_number_required_unless_custom" CHECK ("isCustom" OR "number" IS NOT NULL);`,

  `ALTER TABLE "UsersCurrencies"
     ADD COLUMN "nameOverride" VARCHAR(255),
     ADD COLUMN "symbolOverride" VARCHAR(8),
     ADD COLUMN "decimalsOverride" INTEGER,
     ADD COLUMN "logoDomain" VARCHAR(253),
     ADD COLUMN "logoInitials" VARCHAR(16),
     ADD COLUMN "logoColor" VARCHAR(7),
     ADD COLUMN "logoIcon" VARCHAR(64),
     ADD COLUMN "logoImageId" UUID;`,
  `ALTER TABLE "UsersCurrencies"
     ADD CONSTRAINT "UsersCurrencies_decimalsOverride_range" CHECK ("decimalsOverride" IS NULL OR "decimalsOverride" BETWEEN 0 AND 8);`,

  ...CURRENCY_CODE_COLUMNS.map(
    ({ table, column }) =>
      `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} TYPE VARCHAR(${CURRENCY_CODE_MAX_LENGTH});`,
  ),

  createRealTransactionsViewSql,
];

const downStatements = (): string[] => [
  dropRealTransactionsViewSql,

  ...CURRENCY_CODE_COLUMNS.slice()
    .reverse()
    .map(
      ({ table, column }) =>
        `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} TYPE VARCHAR(${ISO_CURRENCY_CODE_LENGTH});`,
    ),

  `ALTER TABLE "UsersCurrencies" DROP CONSTRAINT "UsersCurrencies_decimalsOverride_range";`,
  `ALTER TABLE "UsersCurrencies"
     DROP COLUMN "nameOverride",
     DROP COLUMN "symbolOverride",
     DROP COLUMN "decimalsOverride",
     DROP COLUMN "logoDomain",
     DROP COLUMN "logoInitials",
     DROP COLUMN "logoColor",
     DROP COLUMN "logoIcon",
     DROP COLUMN "logoImageId";`,

  `ALTER TABLE "Currencies" DROP CONSTRAINT "Currencies_number_required_unless_custom";`,
  `ALTER TABLE "Currencies"
     DROP COLUMN "isCustom",
     ALTER COLUMN "number" SET NOT NULL;`,

  createRealTransactionsViewSql,
];

/** What `down` would destroy or fail on, as readable lines. Empty when it is safe to run. */
const findDownBlockers = async ({ run }: { run: (sql: string) => Promise<unknown> }): Promise<string[]> => {
  const countOf = async (sql: string): Promise<number> => {
    const [rows] = (await run(sql)) as [{ count: number }[], unknown];
    return rows[0]?.count ?? 0;
  };

  const blockers: string[] = [];

  const customCurrencies = await countOf(countSql({ table: 'Currencies', where: '"isCustom" OR "number" IS NULL' }));
  if (customCurrencies > 0) blockers.push(`${customCurrencies} custom currencies in "Currencies"`);

  for (const { table, column } of CURRENCY_CODE_COLUMNS) {
    const tooLong = await countOf(countSql({ table, where: `length(${quote(column)}) > ${ISO_CURRENCY_CODE_LENGTH}` }));
    if (tooLong > 0)
      blockers.push(`${tooLong} codes longer than ${ISO_CURRENCY_CODE_LENGTH} characters in ${table}.${column}`);
  }

  return blockers;
};

const runMigration = async ({
  queryInterface,
  direction,
}: {
  queryInterface: QueryInterface;
  direction: 'up' | 'down';
}): Promise<void> => {
  const t: Transaction = await queryInterface.sequelize.transaction();
  const run = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

  try {
    if (direction === 'down') {
      const blockers = await findDownBlockers({ run });
      if (blockers.length > 0) {
        throw new Error(
          `Cannot revert 20261120000000-custom-currencies while custom-currency data exists: ${blockers.join('; ')}. ` +
            'Delete the custom currencies first.',
        );
      }
    }

    for (const sql of direction === 'up' ? upStatements() : downStatements()) {
      await run(sql);
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
