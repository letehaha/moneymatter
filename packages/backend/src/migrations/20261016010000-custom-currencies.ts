import { Transaction, QueryInterface } from 'sequelize';

import {
  CURRENCY_CODE_COLUMNS,
  CURRENCY_CODE_MAX_LENGTH,
  ISO_CURRENCY_CODE_LENGTH,
  NULLABLE_REF_COLUMNS,
} from '../common/lib/currency-code-columns';
import { createRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Schema for per-user custom currencies.
 *
 * - "Currencies" gains "isCustom", "symbol" and "createdByUserId"; "number" (the ISO numeric code)
 *   becomes nullable, because a custom row has none. "createdByUserId" deliberately has no foreign
 *   key: "Currencies" is reference data that must survive a `TRUNCATE "Users" CASCADE`, which a
 *   constraint pointing at "Users" would turn into a wipe of every currency. A check keeps it required on every row that is
 *   not custom, so an ISO code can never lose its number.
 * - "UsersCurrencies" gains "nameOverride", "symbolOverride" and "decimalsOverride" (0 to 18, the
 *   scale of the money columns): what the user sees and how many decimals their amounts keep.
 * - The currency-code columns listed in `common/lib/currency-code-columns.ts` widen from
 *   varchar(3) to varchar(16). Postgres rebuilds the foreign keys that reference
 *   "Currencies"."code" when it changes the type, so no constraint is dropped by hand.
 * - The base-currency amounts of transactions, splits and accounts become nullable, and
 *   "Transactions"."refAmountMissing" marks a row whose amount could not be converted.
 *
 * `real_transactions` is `SELECT * FROM "Transactions"`, so it is dropped before the column types
 * change and recreated afterwards, which also lets it expose the new column.
 *
 * `down` refuses to run while a custom currency, a code longer than three characters, a null
 * base-currency amount or a flagged transaction exists, because narrowing the columns or restoring
 * the NOT NULL constraints would otherwise fail halfway or silently destroy data. Once none
 * exists it reverses every change. The overrides on "UsersCurrencies" are dropped with their
 * columns, including those a user set on an ISO code.
 */

const quote = (identifier: string): string => `"${identifier}"`;

const countSql = ({ table, where }: { table: string; where: string }): string =>
  `SELECT count(*)::int AS count FROM ${quote(table)} WHERE ${where}`;

const upStatements = (): string[] => [
  dropRealTransactionsViewSql,

  `ALTER TABLE "Currencies"
     ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN "symbol" VARCHAR(8),
     ADD COLUMN "createdByUserId" INTEGER,
     ALTER COLUMN "number" DROP NOT NULL;`,
  `ALTER TABLE "Currencies"
     ADD CONSTRAINT "Currencies_number_required_unless_custom" CHECK ("isCustom" OR "number" IS NOT NULL);`,
  `CREATE INDEX "currencies_created_by_user_id_idx" ON "Currencies" ("createdByUserId") WHERE "createdByUserId" IS NOT NULL;`,

  `ALTER TABLE "UsersCurrencies"
     ADD COLUMN "nameOverride" VARCHAR(255),
     ADD COLUMN "symbolOverride" VARCHAR(8),
     ADD COLUMN "decimalsOverride" INTEGER;`,
  `ALTER TABLE "UsersCurrencies"
     ADD CONSTRAINT "UsersCurrencies_decimalsOverride_range" CHECK ("decimalsOverride" IS NULL OR "decimalsOverride" BETWEEN 0 AND 18);`,

  ...CURRENCY_CODE_COLUMNS.map(
    ({ table, column }) =>
      `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} TYPE VARCHAR(${CURRENCY_CODE_MAX_LENGTH});`,
  ),

  ...NULLABLE_REF_COLUMNS.map(
    ({ table, column }) => `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} DROP NOT NULL;`,
  ),
  `ALTER TABLE "Transactions" ADD COLUMN "refAmountMissing" BOOLEAN NOT NULL DEFAULT false;`,

  createRealTransactionsViewSql,
];

const downStatements = (): string[] => [
  dropRealTransactionsViewSql,

  `ALTER TABLE "Transactions" DROP COLUMN "refAmountMissing";`,
  ...NULLABLE_REF_COLUMNS.map(
    ({ table, column }) => `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} SET NOT NULL;`,
  ),

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
     DROP COLUMN "decimalsOverride";`,

  `DROP INDEX "currencies_created_by_user_id_idx";`,
  `ALTER TABLE "Currencies" DROP CONSTRAINT "Currencies_number_required_unless_custom";`,
  `ALTER TABLE "Currencies"
     DROP COLUMN "createdByUserId",
     DROP COLUMN "symbol",
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

  for (const { table, column } of NULLABLE_REF_COLUMNS) {
    const missing = await countOf(countSql({ table, where: `${quote(column)} IS NULL` }));
    if (missing > 0) blockers.push(`${missing} null base-currency amounts in ${table}.${column}`);
  }

  const flagged = await countOf(countSql({ table: 'Transactions', where: '"refAmountMissing"' }));
  if (flagged > 0) blockers.push(`${flagged} transactions flagged "refAmountMissing"`);

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
          `Cannot revert 20261016010000-custom-currencies while custom-currency data exists: ${blockers.join('; ')}. ` +
            'Delete the custom currencies and fill or delete the rows without a base-currency amount first.',
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
