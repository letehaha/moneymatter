import { QueryInterface, QueryTypes, Transaction } from 'sequelize';

import {
  MONEY_COLUMNS_20261016,
  MONEY_COLUMN_PRECISION_20261016,
  MONEY_COLUMN_SCALE_20261016,
  MONEY_JSON_FIELDS_20261016,
  MoneyJsonFieldSpec,
} from './utils/money-columns-20261016';
import { createRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Moves every transactional money amount from integer cents (BIGINT) to DECIMAL(36,18), and
 * rewrites the cents held inside JSON fields as decimals. `up` divides by 100, which is lossless.
 *
 * The column and JSON lists are the frozen snapshot in `utils/money-columns-20261016.ts`, the
 * columns that held cents when this migration was written. The live list in
 * `common/lib/money-columns.ts` (backup, restore and the v1 converter read it) grows with the
 * schema and must not be imported here, or a column added later would fail this migration on a
 * fresh database.
 *
 * `real_transactions` selects from "Transactions", and Postgres refuses to change the type of a
 * column a view depends on, so the view is dropped first and recreated afterwards.
 *
 * `down` multiplies by 100 and rounds half away from zero, so it is lossy for values with more
 * than 2 decimals. A positive value below half a cent becomes 0, which a `> 0` check constraint
 * (e.g. on "BudgetLineGoals"."amount") rejects, so `down` fails until such rows are removed.
 */

const DECIMAL_TYPE = `NUMERIC(${MONEY_COLUMN_PRECISION_20261016},${MONEY_COLUMN_SCALE_20261016})`;

const columnsByTable = ({ budgetsTable }: { budgetsTable: string }): Map<string, string[]> => {
  const byTable = new Map<string, string[]>();
  for (const { table: snapshotTable, column } of MONEY_COLUMNS_20261016) {
    const table = snapshotTable === 'Budgets' ? budgetsTable : snapshotTable;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  return byTable;
};

// `Array.from` rather than spreading the Map: the e2e template runner transpiles migrations
// with ts-node's default target, where spreading a Map silently yields an empty array and the
// migration would be recorded as applied without altering a single column.
const alterColumnTypesSql = ({
  direction,
  budgetsTable,
}: {
  direction: 'up' | 'down';
  budgetsTable: string;
}): string[] =>
  Array.from(columnsByTable({ budgetsTable }), ([table, columns]) => {
    const clauses = columns.map((column) =>
      direction === 'up'
        ? `ALTER COLUMN "${column}" TYPE ${DECIMAL_TYPE} USING "${column}"::numeric / 100`
        : `ALTER COLUMN "${column}" TYPE BIGINT USING round("${column}" * 100)::bigint`,
    );
    return `ALTER TABLE "${table}" ${clauses.join(', ')};`;
  });

/** SQL turning one amount JSON value (`value` is a jsonb scalar) into its converted jsonb. */
const convertedJsonNumber = ({ direction }: { direction: 'up' | 'down' }): string =>
  direction === 'up'
    ? `to_jsonb(trim_scale((kv.value #>> '{}')::numeric / 100))`
    : `to_jsonb(round((kv.value #>> '{}')::numeric * 100))`;

/** SQL rebuilding the jsonb object `objectSql`, converting the amount keys and keeping every other entry. */
const convertedJsonObject = ({
  objectSql,
  keys,
  direction,
}: {
  objectSql: string;
  keys: readonly string[];
  direction: 'up' | 'down';
}): string => {
  const keyList = keys.map((key) => `'${key}'`).join(', ');
  return `COALESCE((
    SELECT jsonb_object_agg(
      kv.key,
      CASE WHEN kv.key IN (${keyList}) AND jsonb_typeof(kv.value) = 'number'
        THEN ${convertedJsonNumber({ direction })}
        ELSE kv.value
      END
    )
    FROM jsonb_each(${objectSql}) AS kv
  ), '{}'::jsonb)`;
};

const rewriteJsonFieldSql = ({ field, direction }: { field: MoneyJsonFieldSpec; direction: 'up' | 'down' }): string => {
  const { table, column, shape, keys, path } = field;

  if (shape === 'object' && path?.length) {
    const pathSql = `'{${path.join(',')}}'`;
    const nestedSql = `("${column}" #> ${pathSql})`;
    return `UPDATE "${table}"
      SET "${column}" = jsonb_set("${column}", ${pathSql}, ${convertedJsonObject({ objectSql: nestedSql, keys, direction })})
      WHERE jsonb_typeof(${nestedSql}) = 'object';`;
  }

  if (shape === 'object') {
    return `UPDATE "${table}"
      SET "${column}" = ${convertedJsonObject({ objectSql: `"${column}"`, keys, direction })}
      WHERE jsonb_typeof("${column}") = 'object';`;
  }

  return `UPDATE "${table}"
    SET "${column}" = COALESCE((
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(element) = 'object'
          THEN ${convertedJsonObject({ objectSql: 'element', keys, direction })}
          ELSE element
        END
      )
      FROM jsonb_array_elements("${column}") AS element
    ), '[]'::jsonb)
    WHERE jsonb_typeof("${column}") = 'array';`;
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
    // `20261019000000-rename-budgets-to-trackers` renames the table. A database that already ran it still
    // has this migration pending when it was written before the rename, so it follows the table.
    const rows = (await queryInterface.sequelize.query(
      `SELECT to_regclass('"Budgets"') IS NULL AND to_regclass('"Trackers"') IS NOT NULL AS renamed`,
      { type: QueryTypes.SELECT, transaction: t },
    )) as { renamed: boolean }[];
    const budgetsTable = rows[0]?.renamed ? 'Trackers' : 'Budgets';

    await run(dropRealTransactionsViewSql);
    for (const sql of alterColumnTypesSql({ direction, budgetsTable })) {
      await run(sql);
    }
    for (const field of MONEY_JSON_FIELDS_20261016) {
      await run(rewriteJsonFieldSql({ field, direction }));
    }
    await run(createRealTransactionsViewSql);

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
