import { QueryInterface, QueryTypes, Transaction } from 'sequelize';

import {
  MONEY_COLUMNS_20261115,
  MONEY_COLUMN_PRECISION_20261115,
  MONEY_COLUMN_SCALE_20261115,
  MONEY_JSON_FIELDS_20261115,
  MoneyJsonFieldSpec,
} from './utils/money-columns-20261115';
import { dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Moves every transactional money amount from integer cents (BIGINT) to DECIMAL(36,18), and
 * rewrites the cents held inside JSON fields as decimals. `up` divides by 100, which is lossless.
 *
 * The column and JSON lists are the frozen snapshot in `utils/money-columns-20261115.ts`, the
 * columns that held cents when this migration was written. Its timestamp follows every migration
 * that creates one of them, so a fresh database and one that already ran those migrations both
 * reach it with every listed column still BIGINT cents. The live list in `common/lib/money-columns.ts`
 * grows with the schema and must not be imported here, or a column added later would fail this
 * migration on a fresh database.
 *
 * Both directions first read the type of every listed column, inside the same transaction, and
 * act on the set as a whole, because the JSON fields carry no marker of their own and can only
 * follow the columns' verdict:
 * - `up`: all integer converts; all already NUMERIC(36,18) changes nothing and logs it, so a
 *   second run (e.g. after a crash between the commit and the migration being recorded) is a
 *   no-op; any mix, other type or missing column throws before anything changes.
 * - `down`: all NUMERIC(36,18) converts back; all already integer changes nothing and logs it;
 *   anything else throws.
 * After converting, it asserts every listed column has the target type. Before rewriting a JSON
 * field it rejects a row whose amount key holds anything but a number or null (e.g. a numeric
 * string), naming the table, row id and key, since such a value cannot be told apart later.
 *
 * `real_transactions` selects from "Transactions", and Postgres refuses to change the type of a
 * column a view depends on, so the view is dropped first and recreated afterwards with its SQL
 * written here, as it stood when this migration was written.
 *
 * `up` sets the comments of the converted columns that describe their unit to decimal wording;
 * `down` puts the cents wording back.
 *
 * `down` multiplies by 100 and rounds half away from zero, so it is lossy for values with more
 * than 2 decimals. A positive value below half a cent becomes 0, which a `> 0` check constraint
 * (e.g. on "BudgetLineGoals"."amount") rejects, so `down` fails until such rows are removed.
 */

type Direction = 'up' | 'down';

const DECIMAL_TYPE = `NUMERIC(${MONEY_COLUMN_PRECISION_20261115},${MONEY_COLUMN_SCALE_20261115})`;

const createRealTransactionsViewSql = `CREATE OR REPLACE VIEW real_transactions AS SELECT * FROM "Transactions" WHERE "isPlanned" = false AND "deletedAt" IS NULL;`;

/** The comments the converted columns carried before (`cents`) and carry after (`decimal`) this migration. */
const COLUMN_COMMENTS: readonly { table: string; column: string; cents: string; decimal: string }[] = [
  {
    table: 'BudgetAssignments',
    column: 'baselineAmount',
    cents: 'Cents, from this period on',
    decimal: 'Amount from this period on',
  },
  {
    table: 'BudgetAssignments',
    column: 'overrideAmount',
    cents: 'Cents, this period only',
    decimal: 'Amount for this period only',
  },
  { table: 'BudgetLineGoals', column: 'amount', cents: 'Cents', decimal: 'Amount' },
  {
    table: 'BudgetLineGoals',
    column: 'stopAtBalance',
    cents: 'Cents; budget_another only',
    decimal: 'Amount; budget_another only',
  },
  {
    table: 'BudgetLineGoals',
    column: 'fundingCap',
    cents: 'Cents per period; refill_up_to only',
    decimal: 'Amount per period; refill_up_to only',
  },
  {
    table: 'BudgetPlans',
    column: 'expectedIncome',
    cents: 'Cents per period, user-entered',
    decimal: 'Amount per period, user-entered',
  },
  {
    table: 'GoalAccounts',
    column: 'fixedAmount',
    cents: "Cents in the account's currency, taken from the balance before any percent share",
    decimal: "Amount in the account's currency, taken from the balance before any percent share",
  },
  { table: 'Goals', column: 'targetAmount', cents: 'Cents in currencyCode', decimal: 'Amount in currencyCode' },
  {
    table: 'Goals',
    column: 'plannedMonthly',
    cents: 'Cents per month in currencyCode',
    decimal: 'Amount per month in currencyCode',
  },
  {
    table: 'Goals',
    column: 'achievedAmount',
    cents: 'Cents in currencyCode, the value when the goal was first reached',
    decimal: 'Amount in currencyCode, the value when the goal was first reached',
  },
  {
    table: 'LoanDetails',
    column: 'originalPrincipal',
    cents: 'Lender-issued principal in cents; immutable after create',
    decimal: 'Lender-issued principal; immutable after create',
  },
  {
    table: 'LoanDetails',
    column: 'refOriginalPrincipal',
    cents: 'originalPrincipal converted to user base currency at create time, in cents',
    decimal: 'originalPrincipal converted to user base currency at create time',
  },
  {
    table: 'LoanDetails',
    column: 'minPayment',
    cents: 'Minimum required monthly payment in cents',
    decimal: 'Minimum required monthly payment',
  },
  {
    table: 'SubscriptionCandidates',
    column: 'averageAmount',
    cents: 'Average amount in cents',
    decimal: 'Average amount',
  },
  { table: 'Subscriptions', column: 'expectedAmount', cents: 'Expected amount in cents', decimal: 'Expected amount' },
  {
    table: 'TrackerLines',
    column: 'limitAmount',
    cents: 'Cents; NULL = no limit on this line',
    decimal: 'Amount; NULL = no limit on this line',
  },
  {
    table: 'TransactionTemplates',
    column: 'amount',
    cents: 'Amount in cents; null means the user enters it each time',
    decimal: 'Amount; null means the user enters it each time',
  },
  { table: 'Vehicles', column: 'purchasePrice', cents: 'Purchase price in cents', decimal: 'Purchase price' },
  {
    table: 'Vehicles',
    column: 'valueAnchor',
    cents: 'Manual override value in cents; depreciation runs from here when set',
    decimal: 'Manual override value; depreciation runs from here when set',
  },
];

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const columnsByTable = (): Map<string, string[]> => {
  const byTable = new Map<string, string[]>();
  for (const { table, column } of MONEY_COLUMNS_20261115) {
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  return byTable;
};

// `Array.from` rather than spreading the Map: the e2e template runner transpiles migrations
// with ts-node's default target, where spreading a Map silently yields an empty array and the
// migration would be recorded as applied without altering a single column. The type assertion
// after the ALTERs catches that case too.
const alterColumnTypesSql = ({ direction }: { direction: Direction }): string[] =>
  Array.from(columnsByTable(), ([table, columns]) => {
    const clauses = columns.map((column) =>
      direction === 'up'
        ? `ALTER COLUMN "${column}" TYPE ${DECIMAL_TYPE} USING "${column}"::numeric / 100`
        : `ALTER COLUMN "${column}" TYPE BIGINT USING round("${column}" * 100)::bigint`,
    );
    return `ALTER TABLE "${table}" ${clauses.join(', ')};`;
  });

const columnCommentsSql = ({ direction }: { direction: Direction }): string[] =>
  COLUMN_COMMENTS.map(
    ({ table, column, cents, decimal }) =>
      `COMMENT ON COLUMN "${table}"."${column}" IS ${sqlString(direction === 'up' ? decimal : cents)};`,
  );

// ---------------------------------------------------------------------------
// Column state
// ---------------------------------------------------------------------------

interface ColumnTypeRow {
  table_name: string;
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

type ColumnState = 'integer' | 'decimal' | 'other' | 'missing';

const INTEGER_TYPES = ['bigint', 'integer'];

const stateOf = ({ row }: { row: ColumnTypeRow | undefined }): ColumnState => {
  if (!row) return 'missing';
  if (INTEGER_TYPES.includes(row.data_type)) return 'integer';
  if (
    row.data_type === 'numeric' &&
    row.numeric_precision === MONEY_COLUMN_PRECISION_20261115 &&
    row.numeric_scale === MONEY_COLUMN_SCALE_20261115
  ) {
    return 'decimal';
  }
  return 'other';
};

/** Every listed column, labelled `Table.column (type)`, grouped by state. */
const readColumnStates = async ({
  queryInterface,
  transaction,
}: {
  queryInterface: QueryInterface;
  transaction: Transaction;
}): Promise<Map<ColumnState, string[]>> => {
  const pairs = MONEY_COLUMNS_20261115.map(({ table, column }) => `(${sqlString(table)}, ${sqlString(column)})`);
  const rows = await queryInterface.sequelize.query<ColumnTypeRow>(
    `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND (table_name, column_name) IN (${pairs.join(', ')})`,
    { transaction, type: QueryTypes.SELECT },
  );

  const states = new Map<ColumnState, string[]>();
  for (const { table, column } of MONEY_COLUMNS_20261115) {
    const row = rows.find((candidate) => candidate.table_name === table && candidate.column_name === column);
    const state = stateOf({ row });
    const type = !row
      ? 'missing'
      : row.data_type === 'numeric'
        ? `numeric(${row.numeric_precision},${row.numeric_scale})`
        : row.data_type;
    states.set(state, [...(states.get(state) ?? []), `${table}.${column} (${type})`]);
  }
  return states;
};

const describeStates = ({ states }: { states: Map<ColumnState, string[]> }): string =>
  Array.from(states, ([state, columns]) => `${state}: ${columns.join(', ')}`).join('; ');

/** `convert` when every listed column has the source type, `skip` when every one already has the target type. */
const decide = ({
  states,
  direction,
}: {
  states: Map<ColumnState, string[]>;
  direction: Direction;
}): 'convert' | 'skip' => {
  const total = MONEY_COLUMNS_20261115.length;
  const source: ColumnState = direction === 'up' ? 'integer' : 'decimal';
  const target: ColumnState = direction === 'up' ? 'decimal' : 'integer';
  if (states.get(source)?.length === total) return 'convert';
  if (states.get(target)?.length === total) return 'skip';
  throw new Error(
    `money-columns-to-decimal ${direction}: the listed money columns are neither all integer cents nor all ` +
      `${DECIMAL_TYPE}, so it cannot tell which unit their amounts are in. Nothing was changed. ` +
      describeStates({ states }),
  );
};

const assertTargetTypes = async ({
  queryInterface,
  transaction,
  direction,
}: {
  queryInterface: QueryInterface;
  transaction: Transaction;
  direction: Direction;
}): Promise<void> => {
  const states = await readColumnStates({ queryInterface, transaction });
  const target: ColumnState = direction === 'up' ? 'decimal' : 'integer';
  if (states.get(target)?.length !== MONEY_COLUMNS_20261115.length) {
    throw new Error(
      `money-columns-to-decimal ${direction}: after the conversion not every listed column is ` +
        `${direction === 'up' ? DECIMAL_TYPE : 'BIGINT'}. ${describeStates({ states })}`,
    );
  }
};

// ---------------------------------------------------------------------------
// JSON fields
// ---------------------------------------------------------------------------

/** SQL turning one amount JSON value (`value` is a jsonb scalar) into its converted jsonb. */
const convertedJsonNumber = ({ direction }: { direction: Direction }): string =>
  direction === 'up'
    ? `to_jsonb(trim_scale((kv.value #>> '{}')::numeric / 100))`
    : `to_jsonb(round((kv.value #>> '{}')::numeric * 100))`;

const keyListSql = ({ keys }: { keys: readonly string[] }): string => keys.map(sqlString).join(', ');

/** SQL rebuilding the jsonb object `objectSql`, converting the amount keys and keeping every other entry. */
const convertedJsonObject = ({
  objectSql,
  keys,
  direction,
}: {
  objectSql: string;
  keys: readonly string[];
  direction: Direction;
}): string => `COALESCE((
    SELECT jsonb_object_agg(
      kv.key,
      CASE WHEN kv.key IN (${keyListSql({ keys })}) AND jsonb_typeof(kv.value) = 'number'
        THEN ${convertedJsonNumber({ direction })}
        ELSE kv.value
      END
    )
    FROM jsonb_each(${objectSql}) AS kv
  ), '{}'::jsonb)`;

const rewriteJsonFieldSql = ({ field, direction }: { field: MoneyJsonFieldSpec; direction: Direction }): string => {
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

/** `jsonSql` when it is a jsonb value of `type`, otherwise an empty one, so a set-returning function never sees a wrong type. */
const onlyOfType = ({ jsonSql, type }: { jsonSql: string; type: 'object' | 'array' }): string =>
  `CASE WHEN jsonb_typeof(${jsonSql}) = '${type}' THEN ${jsonSql} ELSE '${type === 'object' ? '{}' : '[]'}'::jsonb END`;

/** SQL finding one row whose amount key holds something other than a JSON number or null. */
const invalidJsonAmountSql = ({ field }: { field: MoneyJsonFieldSpec }): string => {
  const { table, column, shape, keys, path } = field;
  const amountFilter = `kv.key IN (${keyListSql({ keys })}) AND jsonb_typeof(kv.value) NOT IN ('number', 'null')`;
  const select = `SELECT row_table."id"::text AS id, kv.key AS key, jsonb_typeof(kv.value) AS type FROM "${table}" AS row_table`;

  if (shape === 'object') {
    const objectSql = path?.length ? `(row_table."${column}" #> '{${path.join(',')}}')` : `row_table."${column}"`;
    return `${select}
      CROSS JOIN LATERAL jsonb_each(${onlyOfType({ jsonSql: objectSql, type: 'object' })}) AS kv
      WHERE ${amountFilter} LIMIT 1`;
  }

  return `${select}
    CROSS JOIN LATERAL jsonb_array_elements(${onlyOfType({ jsonSql: `row_table."${column}"`, type: 'array' })}) AS element
    CROSS JOIN LATERAL jsonb_each(${onlyOfType({ jsonSql: 'element', type: 'object' })}) AS kv
    WHERE ${amountFilter} LIMIT 1`;
};

const assertJsonAmountsAreNumbers = async ({
  queryInterface,
  transaction,
  direction,
}: {
  queryInterface: QueryInterface;
  transaction: Transaction;
  direction: Direction;
}): Promise<void> => {
  for (const field of MONEY_JSON_FIELDS_20261115) {
    const [invalid] = await queryInterface.sequelize.query<{ id: string; key: string; type: string }>(
      invalidJsonAmountSql({ field }),
      { transaction, type: QueryTypes.SELECT },
    );
    if (invalid) {
      throw new Error(
        `money-columns-to-decimal ${direction}: "${field.table}"."${field.column}" of row ${invalid.id} holds a ` +
          `${invalid.type} under the amount key "${invalid.key}", where a number or null is expected. Nothing was changed.`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const runMigration = async ({
  queryInterface,
  direction,
}: {
  queryInterface: QueryInterface;
  direction: Direction;
}): Promise<void> => {
  const t: Transaction = await queryInterface.sequelize.transaction();
  const run = (sql: string) => queryInterface.sequelize.query(sql, { transaction: t });

  try {
    const states = await readColumnStates({ queryInterface, transaction: t });
    if (decide({ states, direction }) === 'skip') {
      console.log(
        `money-columns-to-decimal ${direction}: every listed money column is already ` +
          `${direction === 'up' ? DECIMAL_TYPE : 'integer'}; nothing to change.`,
      );
      await t.commit();
      return;
    }

    await assertJsonAmountsAreNumbers({ queryInterface, transaction: t, direction });

    await run(dropRealTransactionsViewSql);
    for (const sql of alterColumnTypesSql({ direction })) {
      await run(sql);
    }
    for (const field of MONEY_JSON_FIELDS_20261115) {
      await run(rewriteJsonFieldSql({ field, direction }));
    }
    for (const sql of columnCommentsSql({ direction })) {
      await run(sql);
    }
    await run(createRealTransactionsViewSql);

    await assertTargetTypes({ queryInterface, transaction: t, direction });

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
