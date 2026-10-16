import { Transaction, QueryInterface } from 'sequelize';

import {
  MONEY_COLUMNS,
  MONEY_COLUMN_PRECISION,
  MONEY_COLUMN_SCALE,
  MONEY_JSON_FIELDS,
  MoneyJsonFieldSpec,
} from '../common/lib/money-columns';
import { createRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Moves every transactional money amount from integer cents (BIGINT) to DECIMAL(36,18), and
 * rewrites the cents held inside JSON fields as decimals. `up` divides by 100, which is lossless.
 *
 * The column and JSON lists come from `common/lib/money-columns.ts`, which the backup v1
 * converter also reads.
 *
 * `real_transactions` selects from "Transactions", and Postgres refuses to change the type of a
 * column a view depends on, so the view is dropped first and recreated afterwards.
 *
 * `down` multiplies by 100 and rounds half away from zero, so it is lossy for values with more
 * than 2 decimals. A positive value below half a cent becomes 0, which a `> 0` check constraint
 * (e.g. on "BudgetLineGoals"."amount") rejects, so `down` fails until such rows are removed.
 */

const DECIMAL_TYPE = `NUMERIC(${MONEY_COLUMN_PRECISION},${MONEY_COLUMN_SCALE})`;

const columnsByTable = (): Map<string, string[]> => {
  const byTable = new Map<string, string[]>();
  for (const { table, column } of MONEY_COLUMNS) {
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  return byTable;
};

// `Array.from` rather than spreading the Map: the e2e template runner transpiles migrations
// with ts-node's default target, where spreading a Map silently yields an empty array and the
// migration would be recorded as applied without altering a single column.
const alterColumnTypesSql = ({ direction }: { direction: 'up' | 'down' }): string[] =>
  Array.from(columnsByTable(), ([table, columns]) => {
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
  const { table, column, shape, keys } = field;

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
    await run(dropRealTransactionsViewSql);
    for (const sql of alterColumnTypesSql({ direction })) {
      await run(sql);
    }
    for (const field of MONEY_JSON_FIELDS) {
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
