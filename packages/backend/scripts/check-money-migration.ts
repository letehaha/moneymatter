/**
 * Round-trip check for the money-storage migration (`20261016000000-money-columns-to-decimal`).
 *
 * Against a disposable Postgres it applies every migration before that one, seeds rows into every
 * money column (including `real_transactions` and the JSON fields), then runs the migration up,
 * down and up again, asserting column types and values after each step.
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

import {
  MONEY_COLUMNS,
  MONEY_COLUMN_PRECISION,
  MONEY_COLUMN_SCALE,
  MONEY_JSON_FIELDS,
} from '../src/common/lib/money-columns';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Umzug = require('umzug');

const MIGRATION_NAME = '20261016000000-money-columns-to-decimal';
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
// Runner
// ---------------------------------------------------------------------------

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
