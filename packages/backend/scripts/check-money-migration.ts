/**
 * Round-trip check for the money-storage migration (`20261016000000-money-columns-to-decimal`)
 * the custom-currencies migration that follows it (`20261016010000-custom-currencies`) and the
 * rate-sources migration after that (`20261016020000-currency-rate-sources`).
 *
 * Against a disposable Postgres it applies every migration before the money one, seeds rows into
 * every money column (including `real_transactions` and the JSON fields), then runs the money
 * migration up, down and up again, asserting column types and values after each step. On top of
 * that state it runs the custom-currencies migration up, down and up again, and asserts the
 * widened code columns, the new columns and constraints, the nullable base-currency amounts, the
 * view, that the seeded values survive, and that `down` refuses while custom-currency data exists.
 * Last it runs the rate-sources migration up, down and up again over dated user rates and the
 * rate-source columns of the user currency list.
 *
 * Usage (needs a Postgres the script may create and drop a database in):
 *   docker run --rm -d --name mm-migcheck -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
 *   npm run check:money-migration
 *
 * Connection settings come from MIGCHECK_DB_HOST, MIGCHECK_DB_PORT, MIGCHECK_DB_USER and
 * MIGCHECK_DB_PASSWORD (defaults: 127.0.0.1, 55432, postgres, test).
 */
import path from 'node:path';
import { Sequelize } from 'sequelize-typescript';

// The frozen snapshots the migrations themselves read: this script checks those migrations, not the live lists.
import {
  CURRENCY_CODE_COLUMNS_20261016 as CURRENCY_CODE_COLUMNS,
  CURRENCY_CODE_MAX_LENGTH_20261016 as CURRENCY_CODE_MAX_LENGTH,
  ISO_CURRENCY_CODE_LENGTH_20261016 as ISO_CURRENCY_CODE_LENGTH,
  NULLABLE_REF_COLUMNS_20261016 as NULLABLE_REF_COLUMNS,
} from '../src/migrations/utils/currency-code-columns-20261016';
import {
  MONEY_COLUMNS_20261016 as MONEY_COLUMNS,
  MONEY_COLUMN_PRECISION_20261016 as MONEY_COLUMN_PRECISION,
  MONEY_COLUMN_SCALE_20261016 as MONEY_COLUMN_SCALE,
  MONEY_JSON_FIELDS_20261016 as MONEY_JSON_FIELDS,
} from '../src/migrations/utils/money-columns-20261016';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Umzug = require('umzug');

const MIGRATION_NAME = '20261016000000-money-columns-to-decimal';
const CUSTOM_CURRENCIES_MIGRATION_NAME = '20261016010000-custom-currencies';
const RATE_SOURCES_MIGRATION_NAME = '20261016020000-currency-rate-sources';
const DATABASE_NAME = 'money_migration_check';

const connection = {
  host: process.env.MIGCHECK_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.MIGCHECK_DB_PORT ?? 55432),
  username: process.env.MIGCHECK_DB_USER ?? 'postgres',
  password: process.env.MIGCHECK_DB_PASSWORD ?? 'test',
  dialect: 'postgres' as const,
  logging: false,
};

type Direction = 'cents' | 'decimal';

interface SeededRow {
  table: string;
  key: Record<string, unknown>;
  /** Cents per money column; `null` for an absent value. */
  cents: Record<string, number | null>;
  /** Which JSON field values were seeded, keyed `column`. */
  json: Record<string, unknown>;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

const failures: string[] = [];
let passed = 0;

const check = ({ ok, label }: { ok: boolean; label: string }): void => {
  if (ok) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
};

const quote = (identifier: string): string => `"${identifier}"`;

const sqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

const RAW = (sql: string) => ({ __raw: sql });
const isRaw = (value: unknown): value is { __raw: string } =>
  typeof value === 'object' && value !== null && '__raw' in value;
const literal = (value: unknown): string => (isRaw(value) ? value.__raw : sqlLiteral(value));

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

let rowCounter = 0;

const requiredFiller = ({ info, enumLabel }: { info: ColumnInfo; enumLabel: string | null }): string => {
  const { column_name: name, data_type: type } = info;
  if (type === 'uuid') return 'gen_random_uuid()';
  if (['integer', 'bigint', 'smallint', 'numeric', 'double precision'].includes(type)) return '1';
  if (type === 'boolean') return 'false';
  if (type.startsWith('timestamp')) return 'now()';
  if (type === 'date') return 'current_date';
  if (type === 'jsonb' || type === 'json') return `'{}'::jsonb`;
  if (type === 'ARRAY') return `'{}'`;
  if (type === 'USER-DEFINED') return sqlLiteral(enumLabel);
  if (/currencycode/i.test(name)) return `'USD'`;
  // Names sit in unique indexes on several tables.
  if (name === 'name') return `'seed-${rowCounter}'`;
  return `'x'`;
};

/** Cents seeded into row A of the table's `index`-th money column. */
const centsA = (index: number): number => 100005 + 137 * index;

/** Rows seeded per table. Overrides satisfy the table's CHECK constraints and unique keys. */
interface RowPlan {
  label: string;
  overrides?: Record<string, unknown>;
  /** Cents by column; unlisted money columns follow the A (positive) or B (negative/null) default. */
  cents?: Record<string, number | null>;
  kind: 'A' | 'B';
}

const rowPlans = ({ table }: { table: string }): RowPlan[] => {
  switch (table) {
    case 'BudgetLineGoals':
      return [
        {
          label: 'A',
          kind: 'A',
          overrides: { frequency: 'every_period', behavior: 'budget_another' },
          cents: { fundingCap: null },
        },
        {
          label: 'B',
          kind: 'B',
          overrides: { frequency: 'every_period', behavior: 'refill_up_to' },
          cents: { amount: 3, stopAtBalance: null, fundingCap: 250050 },
        },
      ];
    case 'BudgetAssignments':
      return [
        { label: 'A', kind: 'A' },
        {
          label: 'B',
          kind: 'B',
          cents: { baselineAmount: null, overrideAmount: -4200 },
        },
      ];
    case 'Subscriptions':
      return [
        { label: 'A', kind: 'A', overrides: { expectedCurrencyCode: 'USD' } },
        {
          label: 'B',
          kind: 'B',
          overrides: { type: 'bill', expectedCurrencyCode: null },
        },
      ];
    case 'Transactions':
      return [
        {
          label: 'real',
          kind: 'A',
          overrides: { isPlanned: false, transactionType: 'expense' },
        },
        {
          label: 'planned',
          kind: 'B',
          overrides: { isPlanned: true, transactionType: 'expense' },
        },
        {
          label: 'soft-deleted',
          kind: 'A',
          overrides: {
            isPlanned: false,
            deletedAt: RAW('now()'),
            transactionType: 'expense',
          },
        },
      ];
    case 'BudgetPlans':
      return [
        {
          label: 'A',
          kind: 'A',
          overrides: { cadence: 'months', carryPolicy: 'none' },
        },
        {
          label: 'B',
          kind: 'B',
          overrides: { userId: 2, cadence: 'months', carryPolicy: 'none' },
        },
      ];
    case 'ImportBatchAccountEffects':
      return [
        { label: 'A', kind: 'A' },
        {
          label: 'B',
          kind: 'B',
          overrides: { accountId: RAW('gen_random_uuid()') },
        },
      ];
    default:
      return [
        { label: 'A', kind: 'A' },
        { label: 'B', kind: 'B' },
      ];
  }
};

const JSON_SEEDS: Record<string, Record<string, unknown>[]> = {
  TagReminders: [
    {
      settings: {
        amountThreshold: 150000,
        keep: 'me',
        nested: { amountThreshold: 5 },
      },
    },
    { settings: {} },
    { settings: { somethingElse: 99 } },
  ],
  LoanDetails: [
    {
      events: [
        {
          type: 'rate_change',
          at: '2026-01-01T00:00:00.000Z',
          from: 5.5,
          to: 6,
        },
        {
          type: 'planned_payment_change',
          at: '2026-01-02T00:00:00.000Z',
          fromCents: null,
          toCents: 123456,
        },
        {
          type: 'balance_correction',
          at: '2026-01-03T00:00:00.000Z',
          fromCents: 100000,
          toCents: -99950,
        },
        {
          type: 'note',
          at: '2026-01-04T00:00:00.000Z',
          text: 'fromCents stays text',
        },
      ],
    },
    { events: [] },
  ],
  VentureEventLinks: [
    {
      metaData: {
        originalTransactionState: {
          transferNature: 'not_transfer',
          amount: 250075,
          refAmount: -100050,
          note: 'amount stays text',
        },
        amount: 7,
      },
    },
    { metaData: {} },
    { metaData: { originalTransactionState: 'not-an-object' } },
  ],
  PortfolioTransfers: [
    { metaData: { originalTransactionState: { amount: 1999, refAmount: 0, transferId: null } } },
    { metaData: { somethingElse: { amount: 5 } } },
  ],
};

const expectedJson = ({
  table,
  index,
  direction,
}: {
  table: string;
  index: number;
  direction: Direction;
}): Record<string, unknown> => {
  const seed = JSON_SEEDS[table][index];
  const convert = (n: number): number => (direction === 'cents' ? n : n / 100);

  if (table === 'TagReminders') {
    const settings = seed.settings as Record<string, unknown>;
    return typeof settings.amountThreshold === 'number'
      ? {
          settings: {
            ...settings,
            amountThreshold: convert(settings.amountThreshold),
          },
        }
      : { settings };
  }

  if (table === 'VentureEventLinks' || table === 'PortfolioTransfers') {
    const metaData = seed.metaData as Record<string, unknown>;
    const state = metaData.originalTransactionState;
    if (typeof state !== 'object' || state === null) return { metaData };
    const { amount, refAmount } = state as { amount: number; refAmount: number };
    return {
      metaData: {
        ...metaData,
        originalTransactionState: { ...state, amount: convert(amount), refAmount: convert(refAmount) },
      },
    };
  }

  const events = (seed.events as Record<string, unknown>[]).map((event) => {
    if (event.type !== 'planned_payment_change' && event.type !== 'balance_correction') return event;
    return {
      ...event,
      fromCents: typeof event.fromCents === 'number' ? convert(event.fromCents) : event.fromCents,
      toCents: typeof event.toCents === 'number' ? convert(event.toCents) : event.toCents,
    };
  });
  return { events };
};

const tableInfo = async ({ sequelize, table }: { sequelize: Sequelize; table: string }): Promise<ColumnInfo[]> => {
  const [rows] = await sequelize.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${sqlLiteral(table)}`,
  );
  return rows as ColumnInfo[];
};

const primaryKeyColumns = async ({ sequelize, table }: { sequelize: Sequelize; table: string }): Promise<string[]> => {
  const [rows] = await sequelize.query(
    `SELECT a.attname AS name FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = ${sqlLiteral(quote(table))}::regclass AND i.indisprimary`,
  );
  return (rows as { name: string }[]).map((row) => row.name);
};

const seedTable = async ({ sequelize, table }: { sequelize: Sequelize; table: string }): Promise<SeededRow[]> => {
  const columns = await tableInfo({ sequelize, table });
  const pk = await primaryKeyColumns({ sequelize, table });
  const moneyColumns = MONEY_COLUMNS.filter((spec) => spec.table === table).map((spec) => spec.column);
  const jsonField = MONEY_JSON_FIELDS.find((field) => field.table === table);
  const seeded: SeededRow[] = [];

  const jsonSeeds = jsonField ? JSON_SEEDS[table] : null;
  const plans: RowPlan[] = jsonSeeds
    ? jsonSeeds.map((_, i) => ({ label: `json-${i}`, kind: 'A' as const }))
    : rowPlans({ table });

  for (const [planIndex, plan] of plans.entries()) {
    rowCounter += 1;
    const values = new Map<string, unknown>();

    for (const info of columns) {
      const needsValue = info.is_nullable === 'NO' && info.column_default === null;
      if (!needsValue) continue;
      let enumLabel: string | null = null;
      if (info.data_type === 'USER-DEFINED') {
        const [labels] = await sequelize.query(
          `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = ${sqlLiteral(info.udt_name)} ORDER BY enumsortorder LIMIT 1`,
        );
        enumLabel = (labels as { enumlabel: string }[])[0].enumlabel;
      }
      values.set(info.column_name, RAW(requiredFiller({ info, enumLabel })));
    }

    const cents: Record<string, number | null> = {};
    for (const [index, column] of moneyColumns.entries()) {
      const nullable = columns.find((info) => info.column_name === column)?.is_nullable === 'YES';
      const defaultCents = plan.kind === 'A' ? centsA(index) : nullable ? null : -(7 + index);
      cents[column] = plan.cents && column in plan.cents ? plan.cents[column] : defaultCents;
      values.set(column, cents[column]);
    }

    for (const [column, value] of Object.entries(plan.overrides ?? {})) values.set(column, value);
    if (jsonSeeds && jsonField) values.set(jsonField.column, jsonSeeds[planIndex][jsonField.column]);

    if (pk.includes('id') && !values.has('id')) {
      const idInfo = columns.find((info) => info.column_name === 'id');
      if (idInfo?.column_default === null) values.set('id', RAW('gen_random_uuid()'));
    }

    const names = [...values.keys()];
    const [rows] = await sequelize.query(
      `INSERT INTO ${quote(table)} (${names.map(quote).join(', ')})
       VALUES (${names.map((name) => literal(values.get(name))).join(', ')})
       RETURNING ${pk.map(quote).join(', ')}`,
    );
    const key = (rows as Record<string, unknown>[])[0];
    seeded.push({
      table,
      key,
      cents,
      json: jsonField ? { [jsonField.column]: jsonSeeds![planIndex][jsonField.column] } : {},
    });
  }

  return seeded;
};

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const whereKey = ({ key }: { key: Record<string, unknown> }): string =>
  Object.entries(key)
    .map(([column, value]) => `${quote(column)}::text = ${sqlLiteral(String(value))}`)
    .join(' AND ');

const assertColumnTypes = async ({
  sequelize,
  expected,
  step,
}: {
  sequelize: Sequelize;
  expected: Direction;
  step: string;
}): Promise<void> => {
  for (const { table, column } of MONEY_COLUMNS) {
    const [rows] = await sequelize.query(
      `SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${sqlLiteral(table)} AND column_name = ${sqlLiteral(column)}`,
    );
    const info = (
      rows as {
        data_type: string;
        numeric_precision: number;
        numeric_scale: number;
      }[]
    )[0];
    const ok =
      expected === 'decimal'
        ? info?.data_type === 'numeric' &&
          info.numeric_precision === MONEY_COLUMN_PRECISION &&
          info.numeric_scale === MONEY_COLUMN_SCALE
        : info?.data_type === 'bigint';
    check({
      ok,
      label: `${step}: ${table}.${column} is ${expected === 'decimal' ? 'NUMERIC(36,18)' : 'BIGINT'}`,
    });
  }
};

const assertValues = async ({
  sequelize,
  seeded,
  expected,
  step,
}: {
  sequelize: Sequelize;
  seeded: SeededRow[];
  expected: Direction;
  step: string;
}): Promise<void> => {
  for (const row of seeded) {
    for (const [column, cents] of Object.entries(row.cents)) {
      const expectedValue = cents === null ? 'NULL' : expected === 'cents' ? String(cents) : `${cents}::numeric / 100`;
      const [result] = await sequelize.query(
        `SELECT (${quote(column)} IS NOT DISTINCT FROM ${expectedValue}) AS ok, ${quote(column)}::text AS actual
         FROM ${quote(row.table)} WHERE ${whereKey({ key: row.key })}`,
      );
      const { ok, actual } = (result as { ok: boolean; actual: string | null }[])[0] ?? {
        ok: false,
        actual: 'row missing',
      };
      check({
        ok,
        label: `${step}: ${row.table}.${column} ${JSON.stringify(row.key)} expected ${cents === null ? 'NULL' : expected === 'cents' ? cents : cents / 100}, got ${actual}`,
      });
    }
  }

  for (const field of MONEY_JSON_FIELDS) {
    const rows = seeded.filter((row) => row.table === field.table);
    for (const [index, row] of rows.entries()) {
      const want = expectedJson({
        table: field.table,
        index,
        direction: expected,
      })[field.column];
      const [result] = await sequelize.query(
        `SELECT ${quote(field.column)} = ${sqlLiteral(want)} AS ok, ${quote(field.column)}::text AS actual
         FROM ${quote(field.table)} WHERE ${whereKey({ key: row.key })}`,
      );
      const { ok, actual } = (result as { ok: boolean; actual: string }[])[0] ?? { ok: false, actual: 'row missing' };
      check({
        ok,
        label: `${step}: ${field.table}.${field.column} json row ${index}, got ${actual}`,
      });
    }
  }
};

const assertView = async ({
  sequelize,
  expected,
  step,
}: {
  sequelize: Sequelize;
  expected: Direction;
  step: string;
}): Promise<void> => {
  const [rows] = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'real_transactions'
       AND column_name IN ('amount', 'refAmount', 'commissionRate', 'refCommissionRate', 'cashbackAmount', 'originalAmount')`,
  );
  const typed = rows as { column_name: string; data_type: string }[];
  check({
    ok: typed.length === 6,
    label: `${step}: real_transactions exposes the 6 money columns`,
  });
  check({
    ok: typed.every((col) => col.data_type === (expected === 'decimal' ? 'numeric' : 'bigint')),
    label: `${step}: real_transactions money columns are ${expected === 'decimal' ? 'numeric' : 'bigint'}`,
  });

  const [counts] = await sequelize.query(
    `-- planned-ok: the check counts every seeded row, planned and soft-deleted ones included
     SELECT (SELECT count(*) FROM real_transactions)::int AS in_view, (SELECT count(*) FROM "Transactions")::int AS in_table`,
  );
  const { in_view: inView, in_table: inTable } = (counts as { in_view: number; in_table: number }[])[0];
  check({
    ok: inTable === 3 && inView === 1,
    label: `${step}: view keeps only the real, non-deleted row (${inView} of ${inTable})`,
  });
};

// ---------------------------------------------------------------------------
// Custom-currencies migration
// ---------------------------------------------------------------------------

type CustomState = 'before' | 'after';

interface CodeColumnInfo {
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

const columnDetails = async ({
  sequelize,
  table,
  column,
}: {
  sequelize: Sequelize;
  table: string;
  column: string;
}): Promise<CodeColumnInfo | undefined> => {
  const [rows] = await sequelize.query(
    `SELECT data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${sqlLiteral(table)} AND column_name = ${sqlLiteral(column)}`,
  );
  return (rows as CodeColumnInfo[])[0];
};

const statementFails = async ({ sequelize, sql }: { sequelize: Sequelize; sql: string }): Promise<boolean> => {
  try {
    await sequelize.query(sql);
    return false;
  } catch {
    return true;
  }
};

const scalar = async <T>({ sequelize, sql }: { sequelize: Sequelize; sql: string }): Promise<T> => {
  const [rows] = await sequelize.query(sql);
  return Object.values((rows as Record<string, unknown>[])[0])[0] as T;
};

const assertCustomSchema = async ({
  sequelize,
  state,
  step,
}: {
  sequelize: Sequelize;
  state: CustomState;
  step: string;
}): Promise<void> => {
  const after = state === 'after';
  const expectedLength = after ? CURRENCY_CODE_MAX_LENGTH : ISO_CURRENCY_CODE_LENGTH;

  for (const { table, column } of CURRENCY_CODE_COLUMNS) {
    const info = await columnDetails({ sequelize, table, column });
    check({
      ok: info?.data_type === 'character varying' && info.character_maximum_length === expectedLength,
      label: `${step}: ${table}.${column} is varchar(${expectedLength}), got ${info?.character_maximum_length}`,
    });
  }

  const newColumns: { table: string; column: string; type: string; nullable: boolean }[] = [
    { table: 'Currencies', column: 'isCustom', type: 'boolean', nullable: false },
    { table: 'Currencies', column: 'symbol', type: 'character varying', nullable: true },
    { table: 'Currencies', column: 'createdByUserId', type: 'integer', nullable: true },
    { table: 'UsersCurrencies', column: 'nameOverride', type: 'character varying', nullable: true },
    { table: 'UsersCurrencies', column: 'symbolOverride', type: 'character varying', nullable: true },
    { table: 'UsersCurrencies', column: 'decimalsOverride', type: 'integer', nullable: true },
    { table: 'Transactions', column: 'refAmountMissing', type: 'boolean', nullable: false },
  ];
  for (const { table, column, type, nullable } of newColumns) {
    const info = await columnDetails({ sequelize, table, column });
    check({
      ok: after ? info?.data_type === type && (info.is_nullable === 'YES') === nullable : info === undefined,
      label: `${step}: ${table}.${column} ${after ? `is ${type}${nullable ? '' : ' NOT NULL'}` : 'does not exist'}`,
    });
  }

  const refAmountMissing = await columnDetails({ sequelize, table: 'Transactions', column: 'refAmountMissing' });
  check({
    ok: !after || refAmountMissing?.column_default === 'false',
    label: `${step}: Transactions.refAmountMissing defaults to false`,
  });

  const number = await columnDetails({ sequelize, table: 'Currencies', column: 'number' });
  check({
    ok: (number?.is_nullable === 'YES') === after,
    label: `${step}: Currencies.number is ${after ? 'nullable' : 'NOT NULL'}`,
  });

  for (const { table, column } of NULLABLE_REF_COLUMNS) {
    const info = await columnDetails({ sequelize, table, column });
    check({
      ok: (info?.is_nullable === 'YES') === after,
      label: `${step}: ${table}.${column} is ${after ? 'nullable' : 'NOT NULL'}`,
    });
    check({
      ok: info?.data_type === 'numeric',
      label: `${step}: ${table}.${column} stays numeric`,
    });
  }

  const [viewColumns] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'real_transactions' AND column_name = 'refAmountMissing'`,
  );
  check({
    ok: (viewColumns as unknown[]).length === (after ? 1 : 0),
    label: `${step}: real_transactions ${after ? 'exposes' : 'does not expose'} refAmountMissing`,
  });

  const viewCurrency = await columnDetails({ sequelize, table: 'real_transactions', column: 'currencyCode' });
  check({
    ok: viewCurrency?.character_maximum_length === expectedLength,
    label: `${step}: real_transactions.currencyCode is varchar(${expectedLength})`,
  });

  // The foreign keys that reference "Currencies"."code" survive the type change.
  const foreignKeys = await scalar<number>({
    sequelize,
    sql: `SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND confrelid = '"Currencies"'::regclass`,
  });
  check({
    ok: foreignKeys >= 1,
    label: `${step}: foreign keys still reference "Currencies" (${foreignKeys})`,
  });
};

/** Constraint behaviour of the new columns; only valid while the migration is applied. */
const assertCustomConstraints = async ({ sequelize, step }: { sequelize: Sequelize; step: string }): Promise<void> => {
  const isoRows = await scalar<number>({ sequelize, sql: `SELECT count(*)::int FROM "Currencies"` });
  const isoWithNumber = await scalar<number>({
    sequelize,
    sql: `SELECT count(*)::int FROM "Currencies" WHERE NOT "isCustom" AND "number" IS NOT NULL`,
  });
  check({
    ok: isoRows > 100 && isoRows === isoWithNumber,
    label: `${step}: every seeded ISO currency keeps isCustom=false and its number (${isoWithNumber} of ${isoRows})`,
  });

  check({
    ok: await statementFails({
      sequelize,
      sql: `INSERT INTO "Currencies" (code, currency, digits, "number") VALUES ('NONUM', 'No number', 2, NULL)`,
    }),
    label: `${step}: a non-custom currency without a number is rejected`,
  });

  await sequelize.query(
    `INSERT INTO "Currencies" (code, currency, digits, "number", "isCustom", symbol)
     VALUES ('USDT', 'Tether', 6, NULL, true, '₮')`,
  );
  const stored = await scalar<string>({
    sequelize,
    sql: `SELECT "isCustom" || '/' || symbol || '/' || digits FROM "Currencies" WHERE code = 'USDT'`,
  });
  check({ ok: stored === 'true/₮/6', label: `${step}: a 4-letter custom currency is stored (${stored})` });

  // A 16-character code fits, a 17-character one does not.
  const longestCode = 'A'.repeat(CURRENCY_CODE_MAX_LENGTH);
  await sequelize.query(
    `INSERT INTO "Currencies" (code, currency, digits, "number", "isCustom") VALUES ('${longestCode}', 'Longest', 2, NULL, true)`,
  );
  check({
    ok: await statementFails({
      sequelize,
      sql: `INSERT INTO "Currencies" (code, currency, digits, "number", "isCustom") VALUES ('${longestCode}B', 'Too long', 2, NULL, true)`,
    }),
    label: `${step}: a ${CURRENCY_CODE_MAX_LENGTH + 1}-character code is rejected`,
  });

  // Foreign keys on a column that is not part of the seeded money tables still guard the code.
  await sequelize.query(
    `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", date, rate) VALUES ('USDT', 'USD', '2026-01-01', 1)`,
  );
  check({
    ok: await statementFails({
      sequelize,
      sql: `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", date, rate) VALUES ('NOPE', 'USD', '2026-01-01', 1)`,
    }),
    label: `${step}: ExchangeRates still rejects a code that is not in "Currencies"`,
  });
  await sequelize.query(`DELETE FROM "ExchangeRates" WHERE "baseCode" = 'USDT'`);

  const userCurrencyDefaults = await scalar<number>({
    sequelize,
    sql: `SELECT count(*)::int FROM "UsersCurrencies" WHERE "nameOverride" IS NOT NULL OR "symbolOverride" IS NOT NULL OR "decimalsOverride" IS NOT NULL`,
  });
  check({ ok: userCurrencyDefaults === 0, label: `${step}: existing UsersCurrencies rows have no overrides` });

  const userId = await scalar<number>({
    sequelize,
    sql: `INSERT INTO "Users" (username) VALUES ('currency-check') RETURNING id`,
  });

  for (const valid of [0, 18]) {
    await sequelize.query(
      `INSERT INTO "UsersCurrencies" ("userId", "currencyCode", "decimalsOverride") VALUES (${userId}, 'USDT', ${valid})`,
    );
    await sequelize.query(`DELETE FROM "UsersCurrencies" WHERE "currencyCode" = 'USDT'`);
    check({ ok: true, label: `${step}: decimalsOverride ${valid} is accepted` });
  }
  for (const invalid of [-1, 19]) {
    check({
      ok: await statementFails({
        sequelize,
        sql: `INSERT INTO "UsersCurrencies" ("userId", "currencyCode", "decimalsOverride") VALUES (${userId}, 'USDT', ${invalid})`,
      }),
      label: `${step}: decimalsOverride ${invalid} is rejected`,
    });
  }

  // "Currencies" must survive `TRUNCATE "Users" CASCADE` (the e2e suites truncate between tests), so
  // "createdByUserId" is a plain id without a foreign key.
  await sequelize.query(`UPDATE "Currencies" SET "createdByUserId" = ${userId} WHERE code = 'USDT'`);
  const currenciesBefore = await scalar<number>({ sequelize, sql: `SELECT count(*)::int FROM "Currencies"` });
  await sequelize.query(`TRUNCATE TABLE "Users" CASCADE`);
  const currenciesAfter = await scalar<number>({ sequelize, sql: `SELECT count(*)::int FROM "Currencies"` });
  check({
    ok: currenciesBefore > isoRows && currenciesAfter === currenciesBefore,
    label: `${step}: truncating "Users" with CASCADE keeps every currency (${currenciesAfter} of ${currenciesBefore})`,
  });

  await sequelize.query(`DELETE FROM "Currencies" WHERE code IN ('USDT', '${longestCode}')`);
};

/** `down` must refuse, leave the schema untouched, and say why. */
const assertDownRefuses = async ({
  sequelize,
  umzug,
  expectedMessage,
  step,
}: {
  sequelize: Sequelize;
  umzug: { down: () => Promise<unknown> };
  expectedMessage: string;
  step: string;
}): Promise<void> => {
  let message = '';
  try {
    await umzug.down();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check({
    ok: message.includes(expectedMessage),
    label: `${step}: down refuses with "${expectedMessage}", got "${message.slice(0, 160)}"`,
  });

  const accountCurrency = await columnDetails({ sequelize, table: 'Accounts', column: 'currencyCode' });
  check({
    ok: accountCurrency?.character_maximum_length === CURRENCY_CODE_MAX_LENGTH,
    label: `${step}: a refused down leaves the columns widened`,
  });
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rate sources
// ---------------------------------------------------------------------------

const RATE_KEY = `"userId" = 1 AND "baseCode" = 'USD' AND "quoteCode" = 'EUR'`;

const seedUserRates = async ({ sequelize }: { sequelize: Sequelize }): Promise<void> => {
  // The seed has no user or currency parents, which the foreign keys would require.
  const [foreignKeys] = await sequelize.query(
    `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = '"UserExchangeRates"'::regclass`,
  );
  for (const { conname } of foreignKeys as { conname: string }[]) {
    await sequelize.query(`ALTER TABLE "UserExchangeRates" DROP CONSTRAINT ${quote(conname)}`);
  }

  await sequelize.query(`
    INSERT INTO "UserExchangeRates" ("userId", "baseCode", "quoteCode", "rate", "date") VALUES
      (1, 'USD', 'EUR', 0.9,  '2026-03-04 23:59:59+00'),
      (1, 'EUR', 'USD', 1.1,  '2026-03-05 02:00:00+05:00'),
      (2, 'USD', 'EUR', 0.8,  '2026-03-05 00:00:01+00'),
      (1, 'GBP', 'USD', 1.2,  '2026-04-01 08:00:00+00'),
      (1, 'GBP', 'USD', 1.3,  '2026-04-01 20:00:00+00')`);
};

const assertRateSources = async ({
  sequelize,
  state,
  step,
}: {
  sequelize: Sequelize;
  state: 'before' | 'after';
  step: string;
}): Promise<void> => {
  const after = state === 'after';

  const effectiveDate = await columnDetails({ sequelize, table: 'UserExchangeRates', column: 'effectiveDate' });
  const source = await columnDetails({ sequelize, table: 'UserExchangeRates', column: 'source' });
  check({
    ok: after ? effectiveDate?.data_type === 'date' && effectiveDate.is_nullable === 'NO' : effectiveDate === undefined,
    label: `${step}: UserExchangeRates.effectiveDate is ${after ? 'a NOT NULL date' : 'absent'}`,
  });
  check({
    ok: after
      ? source?.data_type === 'character varying' &&
        source.character_maximum_length === 32 &&
        source.is_nullable === 'NO' &&
        source.column_default?.startsWith("'manual'") === true
      : source === undefined,
    label: `${step}: UserExchangeRates.source is ${after ? "a NOT NULL varchar(32) defaulting to 'manual'" : 'absent'}`,
  });

  const keyColumns = await primaryKeyColumns({ sequelize, table: 'UserExchangeRates' });
  const expectedKey = after
    ? ['userId', 'baseCode', 'quoteCode', 'effectiveDate']
    : ['userId', 'baseCode', 'quoteCode', 'date'];
  check({
    ok: JSON.stringify(keyColumns.toSorted()) === JSON.stringify(expectedKey.toSorted()),
    label: `${step}: primary key is (${expectedKey.join(', ')}), got (${keyColumns.join(', ')})`,
  });
};

const SOURCE_CUSTOM_CODE = 'RSCUS';

const seedUserCurrencies = async ({ sequelize }: { sequelize: Sequelize }): Promise<void> => {
  const userId = await scalar<number>({
    sequelize,
    sql: `INSERT INTO "Users" (username) VALUES ('rate-source-check') RETURNING id`,
  });
  await sequelize.query(
    `INSERT INTO "Currencies" (code, currency, digits, "number", "isCustom") VALUES ('${SOURCE_CUSTOM_CODE}', 'Rate source check', 4, NULL, true)`,
  );
  await sequelize.query(
    `INSERT INTO "UsersCurrencies" ("userId", "currencyCode") VALUES (${userId}, 'USD'), (${userId}, '${SOURCE_CUSTOM_CODE}')`,
  );
};

const sourceOf = ({ sequelize, code }: { sequelize: Sequelize; code: string }) =>
  scalar<string>({
    sequelize,
    sql: `SELECT "rateSource" FROM "UsersCurrencies" WHERE "currencyCode" = '${code}'`,
  });

const assertRateSourceColumns = async ({
  sequelize,
  state,
  step,
}: {
  sequelize: Sequelize;
  state: 'before' | 'after';
  step: string;
}): Promise<void> => {
  const after = state === 'after';

  const rateSource = await columnDetails({ sequelize, table: 'UsersCurrencies', column: 'rateSource' });
  const config = await columnDetails({ sequelize, table: 'UsersCurrencies', column: 'rateSourceConfig' });
  const headers = await columnDetails({ sequelize, table: 'UsersCurrencies', column: 'rateSourceHeadersEncrypted' });
  check({
    ok: after
      ? rateSource?.data_type === 'character varying' &&
        rateSource.character_maximum_length === 16 &&
        rateSource.is_nullable === 'NO' &&
        rateSource.column_default?.startsWith("'provider'") === true
      : rateSource === undefined,
    label: `${step}: UsersCurrencies.rateSource is ${after ? "a NOT NULL varchar(16) defaulting to 'provider'" : 'absent'}`,
  });
  check({
    ok: after ? config?.data_type === 'jsonb' && config.is_nullable === 'YES' : config === undefined,
    label: `${step}: UsersCurrencies.rateSourceConfig is ${after ? 'a nullable jsonb' : 'absent'}`,
  });
  check({
    ok: after ? headers?.data_type === 'text' && headers.is_nullable === 'YES' : headers === undefined,
    label: `${step}: UsersCurrencies.rateSourceHeadersEncrypted is ${after ? 'a nullable text' : 'absent'}`,
  });
};

const assertRateSourceValues = async ({ sequelize, step }: { sequelize: Sequelize; step: string }): Promise<void> => {
  // A currency starts on the market feed; a custom one has none, so it starts on manual rates.
  check({
    ok: (await sourceOf({ sequelize, code: 'USD' })) === 'provider',
    label: `${step}: an existing ISO currency row is on the provider`,
  });
  check({
    ok: (await sourceOf({ sequelize, code: SOURCE_CUSTOM_CODE })) === 'manual',
    label: `${step}: an existing custom currency row is on manual rates`,
  });
  check({
    ok:
      (await scalar<number>({
        sequelize,
        sql: `SELECT count(*)::int FROM "UsersCurrencies" WHERE "rateSourceConfig" IS NOT NULL`,
      })) === 0,
    label: `${step}: no existing row has a source config`,
  });
};

const assertRateRows = async ({
  sequelize,
  expected,
  step,
}: {
  sequelize: Sequelize;
  expected: { userId: number; baseCode: string; quoteCode: string; rate: number; effectiveDate?: string }[];
  step: string;
}): Promise<void> => {
  const [rows] = await sequelize.query(
    `SELECT "userId", "baseCode", "quoteCode", "rate", to_char(("date" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS "savedDay",
            ${expected.some((row) => row.effectiveDate) ? `to_char("effectiveDate", 'YYYY-MM-DD')` : 'NULL'} AS "effectiveDate"
       FROM "UserExchangeRates" ORDER BY "userId", "baseCode", "quoteCode", "date"`,
  );
  const actual = rows as {
    userId: number;
    baseCode: string;
    quoteCode: string;
    rate: number;
    savedDay: string;
    effectiveDate: string | null;
  }[];

  check({
    ok: actual.length === expected.length,
    label: `${step}: ${expected.length} user rates, got ${actual.length}`,
  });
  for (const want of expected) {
    const found = actual.find(
      (row) =>
        row.userId === want.userId &&
        row.baseCode === want.baseCode &&
        row.quoteCode === want.quoteCode &&
        Number(row.rate) === want.rate,
    );
    check({
      ok: found !== undefined && (want.effectiveDate === undefined || found.effectiveDate === want.effectiveDate),
      label: `${step}: rate ${want.userId} ${want.baseCode}>${want.quoteCode} = ${want.rate}${want.effectiveDate ? ` from ${want.effectiveDate}` : ''} is stored`,
    });
  }
};

const assertRateConstraints = async ({ sequelize, step }: { sequelize: Sequelize; step: string }): Promise<void> => {
  // One pair can hold a rate per day, but not two for the same day.
  await sequelize.query(
    `INSERT INTO "UserExchangeRates" ("userId", "baseCode", "quoteCode", "rate", "date", "effectiveDate")
     VALUES (1, 'USD', 'EUR', 0.95, now(), '2026-06-01')`,
  );
  check({
    ok: await statementFails({
      sequelize,
      sql: `INSERT INTO "UserExchangeRates" ("userId", "baseCode", "quoteCode", "rate", "date", "effectiveDate")
            VALUES (1, 'USD', 'EUR', 0.96, now(), '2026-06-01')`,
    }),
    label: `${step}: two rates of a pair on one day are rejected`,
  });
  const days = await scalar<number>({
    sequelize,
    sql: `SELECT count(*)::int FROM "UserExchangeRates" WHERE ${RATE_KEY}`,
  });
  check({ ok: days === 2, label: `${step}: a pair holds a rate for each of two days, got ${days}` });
};

const main = async (): Promise<void> => {
  const admin = new Sequelize({ ...connection, database: 'postgres' });
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
  await admin.query(`CREATE DATABASE ${DATABASE_NAME}`);
  await admin.close();

  const sequelize = new Sequelize({ ...connection, database: DATABASE_NAME });
  const migrator = new Sequelize({ ...connection, database: DATABASE_NAME });

  try {
    const umzug = new Umzug({
      migrations: {
        path: path.join(__dirname, '../src/migrations'),
        pattern: /\.(js|ts)$/,
        params: [migrator.getQueryInterface(), Sequelize],
      },
      storage: 'sequelize',
      storageOptions: { sequelize: migrator },
    });

    const pending: { file: string }[] = await umzug.pending();
    const names: string[] = pending.map((migration) => migration.file.replace(/\.(js|ts)$/, ''));
    const ownIndex = names.indexOf(MIGRATION_NAME);
    if (ownIndex < 1) throw new Error(`${MIGRATION_NAME} not found among pending migrations`);

    console.log(`Applying ${ownIndex} migrations before ${MIGRATION_NAME}...`);
    await umzug.up({ to: names[ownIndex - 1] });

    const seeded: SeededRow[] = [];
    const tables = [...new Set([...MONEY_COLUMNS.map((spec) => spec.table), ...MONEY_JSON_FIELDS.map((f) => f.table)])];

    // The seed fills only the columns each row needs, so its parent rows do not exist. The
    // migration rewrites whole tables, which re-validates every foreign key of a rewritten row.
    const [foreignKeys] = await sequelize.query(
      `SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
       WHERE contype = 'f' AND conrelid::regclass::text IN (${tables.map((table) => sqlLiteral(quote(table))).join(', ')})`,
    );
    for (const { tbl, conname } of foreignKeys as {
      tbl: string;
      conname: string;
    }[]) {
      await sequelize.query(`ALTER TABLE ${tbl} DROP CONSTRAINT ${quote(conname)}`);
    }
    for (const table of tables) {
      seeded.push(...(await seedTable({ sequelize, table })));
    }
    console.log(`Seeded ${seeded.length} rows into ${tables.length} tables (${MONEY_COLUMNS.length} money columns).`);

    await assertColumnTypes({ sequelize, expected: 'cents', step: 'seed' });
    await assertValues({ sequelize, seeded, expected: 'cents', step: 'seed' });
    await assertView({ sequelize, expected: 'cents', step: 'seed' });

    await umzug.up({ to: MIGRATION_NAME });
    await assertColumnTypes({ sequelize, expected: 'decimal', step: 'up' });
    await assertValues({ sequelize, seeded, expected: 'decimal', step: 'up' });
    await assertView({ sequelize, expected: 'decimal', step: 'up' });

    // Values past 2 decimals are what `down` loses: it rounds half away from zero.
    const lossyAccount = seeded.find((row) => row.table === 'Accounts' && row.cents.currentBalance !== null)!;
    await sequelize.query(
      `UPDATE "Accounts" SET "currentBalance" = 1.235, "initialBalance" = -1.235 WHERE ${whereKey({ key: lossyAccount.key })}`,
    );
    const lossyAccountCents = {
      ...lossyAccount.cents,
      currentBalance: 124,
      initialBalance: -124,
    };

    await umzug.down();
    const afterDown = seeded.map((row) => (row === lossyAccount ? { ...row, cents: lossyAccountCents } : row));
    await assertColumnTypes({ sequelize, expected: 'cents', step: 'down' });
    await assertValues({
      sequelize,
      seeded: afterDown,
      expected: 'cents',
      step: 'down',
    });
    await assertView({ sequelize, expected: 'cents', step: 'down' });

    await umzug.up({ to: MIGRATION_NAME });
    await assertColumnTypes({
      sequelize,
      expected: 'decimal',
      step: 'up-again',
    });
    await assertValues({
      sequelize,
      seeded: afterDown,
      expected: 'decimal',
      step: 'up-again',
    });
    await assertView({ sequelize, expected: 'decimal', step: 'up-again' });

    // ---- custom-currencies migration, on top of the decimal money storage ----
    await assertCustomSchema({ sequelize, state: 'before', step: 'custom-seed' });
    await umzug.up({ to: CUSTOM_CURRENCIES_MIGRATION_NAME });
    await assertCustomSchema({ sequelize, state: 'after', step: 'custom-up' });
    await assertValues({ sequelize, seeded: afterDown, expected: 'decimal', step: 'custom-up' });
    await assertView({ sequelize, expected: 'decimal', step: 'custom-up' });
    await assertCustomConstraints({ sequelize, step: 'custom-up' });

    // down refuses while any custom-currency data exists, and changes nothing.
    await sequelize.query(
      `INSERT INTO "Currencies" (code, currency, digits, "number", "isCustom") VALUES ('USDT', 'Tether', 6, NULL, true)`,
    );
    await assertDownRefuses({ sequelize, umzug, expectedMessage: 'custom currencies', step: 'custom-down-custom-row' });
    await sequelize.query(`DELETE FROM "Currencies" WHERE code = 'USDT'`);

    const refSeeded = seeded.find((row) => row.table === 'Transactions' && row.cents.refAmount !== null)!;
    await sequelize.query(
      `UPDATE "Transactions" SET "refAmount" = NULL, "refAmountMissing" = true WHERE ${whereKey({ key: refSeeded.key })}`,
    );
    await assertDownRefuses({
      sequelize,
      umzug,
      expectedMessage: 'null base-currency amounts',
      step: 'custom-down-null-ref',
    });
    await sequelize.query(
      `UPDATE "Transactions" SET "refAmount" = 0, "refAmountMissing" = false WHERE ${whereKey({ key: refSeeded.key })}`,
    );

    const splitSeeded = seeded.find((row) => row.table === 'TransactionSplits')!;
    await sequelize.query(
      `UPDATE "TransactionSplits" SET "refAmount" = NULL WHERE ${whereKey({ key: splitSeeded.key })}`,
    );
    await assertDownRefuses({
      sequelize,
      umzug,
      expectedMessage: 'TransactionSplits.refAmount',
      step: 'custom-down-null-split',
    });
    await sequelize.query(`UPDATE "TransactionSplits" SET "refAmount" = 0 WHERE ${whereKey({ key: splitSeeded.key })}`);

    const planSeeded = seeded.find((row) => row.table === 'BudgetPlans')!;
    await sequelize.query(
      `UPDATE "BudgetPlans" SET "currencyCode" = 'USDTX' WHERE ${whereKey({ key: planSeeded.key })}`,
    );
    await assertDownRefuses({
      sequelize,
      umzug,
      expectedMessage: 'BudgetPlans.currencyCode',
      step: 'custom-down-long-code',
    });
    await sequelize.query(`UPDATE "BudgetPlans" SET "currencyCode" = 'USD' WHERE ${whereKey({ key: planSeeded.key })}`);

    // Put the rows touched above back to the seeded values, then a clean down reverses everything.
    for (const { row, column } of [
      { row: refSeeded, column: 'refAmount' },
      { row: splitSeeded, column: 'refAmount' },
    ]) {
      await sequelize.query(
        `UPDATE ${quote(row.table)} SET ${quote(column)} = ${row.cents[column]}::numeric / 100 WHERE ${whereKey({ key: row.key })}`,
      );
    }

    await umzug.down();
    await assertCustomSchema({ sequelize, state: 'before', step: 'custom-down' });
    await assertValues({ sequelize, seeded: afterDown, expected: 'decimal', step: 'custom-down' });
    await assertView({ sequelize, expected: 'decimal', step: 'custom-down' });

    await umzug.up({ to: CUSTOM_CURRENCIES_MIGRATION_NAME });
    await assertCustomSchema({ sequelize, state: 'after', step: 'custom-up-again' });
    await assertValues({ sequelize, seeded: afterDown, expected: 'decimal', step: 'custom-up-again' });
    await assertView({ sequelize, expected: 'decimal', step: 'custom-up-again' });
    await assertCustomConstraints({ sequelize, step: 'custom-up-again' });

    // ---- rate-sources migration: dated user rates ----
    await seedUserRates({ sequelize });
    await seedUserCurrencies({ sequelize });
    await assertRateSources({ sequelize, state: 'before', step: 'rates-seed' });
    await assertRateSourceColumns({ sequelize, state: 'before', step: 'rates-seed' });
    await umzug.up({ to: RATE_SOURCES_MIGRATION_NAME });
    await assertRateSources({ sequelize, state: 'after', step: 'rates-up' });
    await assertRateSourceColumns({ sequelize, state: 'after', step: 'rates-up' });
    await assertRateSourceValues({ sequelize, step: 'rates-up' });
    await sequelize.query(
      `UPDATE "UsersCurrencies" SET "rateSource" = 'peg', "rateSourceConfig" = '{"pegCurrency":"USD","factor":1}'::jsonb WHERE "currencyCode" = '${SOURCE_CUSTOM_CODE}'`,
    );
    // The offset row falls on the day before in UTC; the two GBP rows of one UTC day collapse to the later one.
    const expectedAfterUp = [
      { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.9, effectiveDate: '2026-03-04' },
      { userId: 1, baseCode: 'EUR', quoteCode: 'USD', rate: 1.1, effectiveDate: '2026-03-04' },
      { userId: 2, baseCode: 'USD', quoteCode: 'EUR', rate: 0.8, effectiveDate: '2026-03-05' },
      { userId: 1, baseCode: 'GBP', quoteCode: 'USD', rate: 1.3, effectiveDate: '2026-04-01' },
    ];
    await assertRateRows({ sequelize, expected: expectedAfterUp, step: 'rates-up' });
    check({
      ok:
        (await scalar<number>({
          sequelize,
          sql: `SELECT count(*)::int FROM "UserExchangeRates" WHERE "source" <> 'manual'`,
        })) === 0,
      label: `rates-up: every existing rate is manual`,
    });
    await assertRateConstraints({ sequelize, step: 'rates-up' });

    // down keeps the latest day of each pair: the June rate replaces the March one.
    await umzug.down();
    await assertRateSources({ sequelize, state: 'before', step: 'rates-down' });
    await assertRateSourceColumns({ sequelize, state: 'before', step: 'rates-down' });
    await assertRateRows({
      sequelize,
      expected: [
        { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.95 },
        { userId: 1, baseCode: 'EUR', quoteCode: 'USD', rate: 1.1 },
        { userId: 2, baseCode: 'USD', quoteCode: 'EUR', rate: 0.8 },
        { userId: 1, baseCode: 'GBP', quoteCode: 'USD', rate: 1.3 },
      ],
      step: 'rates-down',
    });

    await umzug.up({ to: RATE_SOURCES_MIGRATION_NAME });
    await assertRateSources({ sequelize, state: 'after', step: 'rates-up-again' });
    await assertRateSourceColumns({ sequelize, state: 'after', step: 'rates-up-again' });
    await assertRateSourceValues({ sequelize, step: 'rates-up-again' });
    const savedToday = new Date().toISOString().slice(0, 10);
    await assertRateRows({
      sequelize,
      expected: [
        { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.95, effectiveDate: savedToday },
        { userId: 1, baseCode: 'EUR', quoteCode: 'USD', rate: 1.1, effectiveDate: '2026-03-04' },
        { userId: 2, baseCode: 'USD', quoteCode: 'EUR', rate: 0.8, effectiveDate: '2026-03-05' },
        { userId: 1, baseCode: 'GBP', quoteCode: 'USD', rate: 1.3, effectiveDate: '2026-04-01' },
      ],
      step: 'rates-up-again',
    });

    // A fractional-cent value fits the new column exactly.
    await sequelize.query(
      `UPDATE "Balances" SET "amount" = 0.00040641 WHERE ${whereKey({ key: seeded.find((row) => row.table === 'Balances')!.key })}`,
    );
    const [[stored]] = (await sequelize.query(
      `SELECT "amount"::text AS amount FROM "Balances" WHERE ${whereKey({ key: seeded.find((row) => row.table === 'Balances')!.key })}`,
    )) as [{ amount: string }[], unknown];
    check({
      ok: Number(stored.amount) === 0.00040641,
      label: `decimal column stores 0.00040641 exactly (got ${stored.amount})`,
    });
  } finally {
    await sequelize.close();
    await migrator.close();
    const cleanup = new Sequelize({ ...connection, database: 'postgres' });
    await cleanup.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
    await cleanup.close();
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
