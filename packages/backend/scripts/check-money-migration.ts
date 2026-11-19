/**
 * Round-trip check for the money-storage migration (`20261115100000-money-columns-to-decimal`).
 *
 * Against a disposable Postgres it applies every migration before that one, seeds rows into every
 * money column (including `real_transactions` and the JSON fields), then runs the migration up,
 * down and up again, asserting column types and values after each step. It also checks that the
 * migration refuses a numeric string under a JSON amount key and a mix of integer and decimal
 * columns without changing anything, and that a second `up` or `down` is a no-op. Rows in JPY and
 * VND check that `up` rounds amounts of currencies with fewer than 2 decimals to those decimals.
 *
 * CI runs it when the migration, its snapshot or this script change (`backend-money-migration` job
 * in `check-source-code.yml`), since the e2e template applies the migration to empty tables only.
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

// The frozen snapshot the migration itself reads: this script checks that migration, not the live list.
import {
  MONEY_COLUMNS_20261115 as MONEY_COLUMNS,
  MONEY_COLUMN_PRECISION_20261115 as MONEY_COLUMN_PRECISION,
  MONEY_COLUMN_SCALE_20261115 as MONEY_COLUMN_SCALE,
  MONEY_JSON_FIELDS_20261115 as MONEY_JSON_FIELDS,
} from '../src/migrations/utils/money-columns-20261115';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Umzug = require('umzug');

const MIGRATION_NAME = '20261115100000-money-columns-to-decimal';
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
  // Recurrence columns sit behind CHECK constraints listing the preset frequencies.
  if (/frequency$/i.test(name)) return `'monthly'`;
  // Names sit in unique indexes on several tables.
  if (name === 'name') return `'seed-${rowCounter}'`;
  return `'x'`;
};

/** Cents seeded into row A of the table's `index`-th money column. */
const centsA = (index: number): number => 100005 + 137 * index;

/** Rows seeded per table. Overrides satisfy the table's CHECK constraints and unique keys. */
interface RowPlan {
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
          kind: 'A',
          overrides: { frequency: 'every_period', behavior: 'budget_another' },
          cents: { fundingCap: null },
        },
        {
          kind: 'B',
          overrides: { frequency: 'every_period', behavior: 'refill_up_to' },
          cents: { amount: 3, stopAtBalance: null, fundingCap: 250050 },
        },
      ];
    case 'BudgetAssignments':
      return [
        { kind: 'A' },
        {
          kind: 'B',
          cents: { baselineAmount: null, overrideAmount: -4200 },
        },
      ];
    case 'Subscriptions':
      return [
        { kind: 'A', overrides: { expectedCurrencyCode: 'USD' } },
        {
          kind: 'B',
          overrides: { type: 'bill', expectedCurrencyCode: null },
        },
      ];
    case 'Transactions':
      return [
        {
          kind: 'A',
          overrides: { isPlanned: false, transactionType: 'expense' },
        },
        {
          kind: 'B',
          overrides: { isPlanned: true, transactionType: 'expense' },
        },
        {
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
          kind: 'A',
          overrides: { cadence: 'months', carryPolicy: 'none' },
        },
        {
          kind: 'B',
          overrides: { userId: 2, cadence: 'months', carryPolicy: 'none' },
        },
      ];
    case 'Goals':
      return [
        { kind: 'A', overrides: { achievedAt: RAW('now()') } },
        {
          kind: 'B',
          cents: { targetAmount: 250000, plannedMonthly: null, achievedAmount: null },
        },
      ];
    case 'GoalAccounts':
      return [
        { kind: 'A', overrides: { sharePercent: null, fixedPosition: 0 } },
        { kind: 'B', overrides: { sharePercent: 50, fixedPosition: null } },
      ];
    case 'ImportBatchAccountEffects':
      return [
        { kind: 'A' },
        {
          kind: 'B',
          overrides: { accountId: RAW('gen_random_uuid()') },
        },
      ];
    default:
      return [{ kind: 'A' }, { kind: 'B' }];
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
    { metaData: { originalTransactionState: { amount: 1999, refAmount: -100050, transferId: null } } },
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

const seedTable = async ({
  sequelize,
  table,
  plans: givenPlans,
}: {
  sequelize: Sequelize;
  table: string;
  plans?: RowPlan[];
}): Promise<SeededRow[]> => {
  const columns = await tableInfo({ sequelize, table });
  const pk = await primaryKeyColumns({ sequelize, table });
  const moneyColumns = MONEY_COLUMNS.filter((spec) => spec.table === table).map((spec) => spec.column);
  const jsonField = MONEY_JSON_FIELDS.find((field) => field.table === table);
  const seeded: SeededRow[] = [];

  const jsonSeeds = jsonField && !givenPlans ? JSON_SEEDS[table] : null;
  // JSON tables alternate A and B rows too, so their own money columns get NULL and negative values.
  const plans: RowPlan[] =
    givenPlans ??
    (jsonSeeds
      ? jsonSeeds.map((_, i) => ({ kind: i % 2 === 0 ? ('A' as const) : ('B' as const) }))
      : rowPlans({ table }));

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
    seeded.push({ table, key, cents });
  }

  return seeded;
};

/** A row in a currency with fewer than 2 decimals, with what its amounts hold after `up`. */
interface RoundingCase {
  row: SeededRow;
  /** Decimal per money column after `up`; `down` turns it into cents. */
  rounded: Record<string, string | null>;
  json?: { column: string; decimal: unknown; cents: unknown };
}

const ROUNDING_USER_ID = 77;

/**
 * JPY and VND carry 0 decimals. Native amounts round half-up, converted ones half-even unless their
 * currency is the native one, and a positive value that would round to 0 under a `> 0` check stays.
 */
const seedRoundingCases = async ({ sequelize }: { sequelize: Sequelize }): Promise<RoundingCase[]> => {
  await sequelize.query(
    `INSERT INTO "Currencies" ("code", "currency", "digits", "number") VALUES ('JPY', 'Yen', 0, 392), ('VND', 'Dong', 0, 704)
     ON CONFLICT ("code") DO UPDATE SET "digits" = EXCLUDED."digits"`,
  );
  await seedTable({
    sequelize,
    table: 'UsersCurrencies',
    plans: [{ kind: 'B', overrides: { userId: ROUNDING_USER_ID, currencyCode: 'JPY', isDefaultCurrency: true } }],
  });
  const seedOne = async ({ table, plan }: { table: string; plan: RowPlan }): Promise<SeededRow> =>
    (await seedTable({ sequelize, table, plans: [plan] }))[0]!;

  // Soft-deleted: `up` rounds rows outside `real_transactions` too.
  const transaction = await seedOne({
    table: 'Transactions',
    plan: {
      kind: 'B',
      overrides: {
        isPlanned: false,
        deletedAt: RAW('now()'),
        transactionType: 'expense',
        currencyCode: 'JPY',
        refCurrencyCode: 'VND',
      },
      cents: {
        amount: 150050,
        refAmount: 25050,
        commissionRate: -150050,
        refCommissionRate: 25150,
        cashbackAmount: 0,
        originalAmount: null,
        paymentAmount: null,
      },
    },
  });
  const split = await seedOne({
    table: 'TransactionSplits',
    plan: { kind: 'B', overrides: { transactionId: transaction.key.id }, cents: { amount: 50, refAmount: 150 } },
  });
  const account = await seedOne({
    table: 'Accounts',
    plan: {
      kind: 'B',
      overrides: { currencyCode: 'JPY', userId: ROUNDING_USER_ID },
      cents: {
        initialBalance: 0,
        refInitialBalance: 0,
        currentBalance: 100049,
        refCurrentBalance: 100050,
        creditLimit: 0,
        refCreditLimit: 0,
      },
    },
  });
  const goal = await seedOne({
    table: 'Goals',
    plan: {
      kind: 'B',
      overrides: { currencyCode: 'JPY' },
      cents: { targetAmount: 40, plannedMonthly: 250, achievedAmount: null },
    },
  });
  const snapshot = { currencyCode: 'JPY', refCurrencyCode: 'VND' };
  const link = await seedOne({
    table: 'VentureEventLinks',
    plan: {
      kind: 'B',
      overrides: { metaData: { originalTransactionState: { ...snapshot, amount: 150050, refAmount: 25050 } } },
    },
  });

  return [
    {
      row: transaction,
      rounded: {
        amount: '1501',
        refAmount: '250',
        commissionRate: '-1501',
        refCommissionRate: '252',
        cashbackAmount: '0',
        originalAmount: null,
        paymentAmount: null,
      },
    },
    { row: split, rounded: { amount: '1', refAmount: '2' } },
    {
      row: account,
      rounded: {
        initialBalance: '0',
        refInitialBalance: '0',
        currentBalance: '1000',
        refCurrentBalance: '1001',
        creditLimit: '0',
        refCreditLimit: '0',
      },
    },
    { row: goal, rounded: { targetAmount: '0.4', plannedMonthly: '3', achievedAmount: null } },
    {
      row: link,
      rounded: {},
      json: {
        column: 'metaData',
        decimal: { originalTransactionState: { ...snapshot, amount: 1501, refAmount: 250 } },
        cents: { originalTransactionState: { ...snapshot, amount: 150100, refAmount: 25000 } },
      },
    },
  ];
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

const assertRounding = async ({
  sequelize,
  cases,
  expected,
  step,
}: {
  sequelize: Sequelize;
  cases: RoundingCase[];
  expected: Direction;
  step: string;
}): Promise<void> => {
  for (const { row, rounded, json } of cases) {
    const checks = Object.entries(rounded).map(([column, decimal]) => ({
      column,
      want:
        decimal === null ? 'NULL' : expected === 'decimal' ? `${decimal}::numeric` : `round(${decimal}::numeric * 100)`,
    }));
    if (json)
      checks.push({ column: json.column, want: sqlLiteral(expected === 'decimal' ? json.decimal : json.cents) });

    for (const { column, want } of checks) {
      const [result] = await sequelize.query(
        `SELECT (${quote(column)} IS NOT DISTINCT FROM ${want}) AS ok, ${quote(column)}::text AS actual
         FROM ${quote(row.table)} WHERE ${whereKey({ key: row.key })}`,
      );
      const { ok, actual } = (result as { ok: boolean; actual: string | null }[])[0] ?? {
        ok: false,
        actual: 'row missing',
      };
      check({ ok, label: `${step}: rounded ${row.table}.${column} expected ${want}, got ${actual}` });
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
  const viewColumns = MONEY_COLUMNS.filter((spec) => spec.table === 'Transactions').map((spec) => spec.column);
  const [rows] = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'real_transactions'
       AND column_name IN (${viewColumns.map(sqlLiteral).join(', ')})`,
  );
  const typed = rows as { column_name: string; data_type: string }[];
  check({
    ok: typed.length === viewColumns.length,
    label: `${step}: real_transactions exposes the ${viewColumns.length} money columns (got ${typed.length})`,
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
    ok: inTable === 4 && inView === 1,
    label: `${step}: view keeps only the real, non-deleted row (${inView} of ${inTable})`,
  });
};
/**
 * Integer columns of the snapshot's tables that are not money. After `up`, any other integer
 * column there would be a cents column the snapshot missed.
 */
const NON_MONEY_INTEGER_COLUMNS = new Set<string>([
  'Accounts.userId',
  'BudgetLineGoals.repeatEvery',
  'BudgetLineGoals.weekday',
  'BudgetPlans.intervalN',
  'BudgetPlans.secondAnchorDay',
  'BudgetPlans.userId',
  'GoalAccounts.fixedPosition',
  'Goals.reachedHoldDays',
  'Goals.sortOrder',
  'Goals.userId',
  'LoanDetails.paymentDayOfMonth',
  'LoanDetails.termMonths',
  'LoanDetails.userId',
  'PortfolioTransfers.userId',
  'RefundTransactions.userId',
  'SubscriptionCandidates.detectedIntervalCount',
  'SubscriptionCandidates.occurrenceCount',
  'SubscriptionCandidates.userId',
  'Subscriptions.anchorDay',
  'Subscriptions.intervalCount',
  'Subscriptions.maxOccurrences',
  'Subscriptions.userId',
  'TagReminders.dayOfMonth',
  'TagReminders.userId',
  'TrackerLines.position',
  'Trackers.aiPreWindowDays',
  'Trackers.userId',
  'TransactionSplits.userId',
  'TransactionTemplates.userId',
  'Transactions.userId',
  'Vehicles.currentMileage',
  'Vehicles.userId',
  'Vehicles.year',
]);

const assertNoUnlistedIntegerColumns = async ({
  sequelize,
  tables,
  step,
}: {
  sequelize: Sequelize;
  tables: string[];
  step: string;
}): Promise<void> => {
  const [rows] = await sequelize.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('bigint', 'integer', 'smallint')
       AND table_name IN (${tables.map(sqlLiteral).join(', ')})
     ORDER BY table_name, column_name`,
  );
  const unexpected = (rows as { table_name: string; column_name: string }[])
    .map((row) => `${row.table_name}.${row.column_name}`)
    .filter((name) => !NON_MONEY_INTEGER_COLUMNS.has(name));
  check({
    ok: unexpected.length === 0,
    label: `${step}: no integer column left in the money tables outside the non-money list (found ${unexpected.join(', ') || 'none'})`,
  });
};

/** Listed columns whose database comment mentions cents. */
const centsComments = async ({ sequelize }: { sequelize: Sequelize }): Promise<string[]> => {
  const found: string[] = [];
  for (const { table, column } of MONEY_COLUMNS) {
    const [[row]] = (await sequelize.query(
      `SELECT col_description(${sqlLiteral(quote(table))}::regclass, a.attnum) AS comment
       FROM pg_attribute a WHERE a.attrelid = ${sqlLiteral(quote(table))}::regclass AND a.attname = ${sqlLiteral(column)}`,
    )) as [{ comment: string | null }[], unknown];
    if (row?.comment && /\bcents\b/i.test(row.comment)) found.push(`${table}.${column}`);
  }
  return found;
};

interface MigrationModule {
  up: (queryInterface: unknown) => Promise<void>;
  down: (queryInterface: unknown) => Promise<void>;
}

/** Runs `run` and records whether it threw an error whose message contains every part of `messageParts`. */
const expectRejection = async ({
  run,
  messageParts,
  label,
}: {
  run: () => Promise<void>;
  messageParts: string[];
  label: string;
}): Promise<void> => {
  let message: string | null = null;
  try {
    await run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check({
    ok: message !== null && messageParts.every((part) => message!.includes(part)),
    label: `${label} (got ${message === null ? 'no error' : JSON.stringify(message)})`,
  });
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const runChecks = async ({ sequelize, migrator }: { sequelize: Sequelize; migrator: Sequelize }): Promise<void> => {
  const umzug = new Umzug({
    migrations: {
      path: path.join(__dirname, '../src/migrations'),
      pattern: /\.(js|ts)$/,
      params: [migrator.getQueryInterface(), Sequelize],
    },
    storage: 'sequelize',
    storageOptions: { sequelize: migrator },
  });
  // The same module umzug runs, called directly to run a step umzug has already recorded.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const migration: MigrationModule = require(path.join(__dirname, '../src/migrations', `${MIGRATION_NAME}.ts`));
  const queryInterface = migrator.getQueryInterface();

  const pending: { file: string }[] = await umzug.pending();
  const names: string[] = pending.map((entry) => entry.file.replace(/\.(js|ts)$/, ''));
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
     WHERE contype = 'f' AND conrelid::regclass::text IN (${[...tables, 'UsersCurrencies'].map((table) => sqlLiteral(quote(table))).join(', ')})`,
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
  const roundingCases = await seedRoundingCases({ sequelize });

  const assertState = async ({ expected, step, rows }: { expected: Direction; step: string; rows: SeededRow[] }) => {
    await assertColumnTypes({ sequelize, expected, step });
    await assertValues({ sequelize, seeded: rows, expected, step });
    await assertView({ sequelize, expected, step });
  };

  await assertState({ expected: 'cents', step: 'seed', rows: seeded });
  const seedCentsComments = await centsComments({ sequelize });
  check({ ok: seedCentsComments.length > 0, label: `seed: some money columns carry a cents comment` });

  // A JSON amount key holding anything but a number or null makes `up` refuse before any change.
  const jsonProbes: { table: string; column: string; key: string; jsonSql: string }[] = [
    {
      table: 'TagReminders',
      column: 'settings',
      key: 'amountThreshold',
      jsonSql: `jsonb_set("settings", '{amountThreshold}', '"150000"')`,
    },
    {
      table: 'LoanDetails',
      column: 'events',
      key: 'toCents',
      jsonSql: `jsonb_set("events", '{1,toCents}', '"123456"')`,
    },
    {
      table: 'VentureEventLinks',
      column: 'metaData',
      key: 'refAmount',
      jsonSql: `jsonb_set("metaData", '{originalTransactionState,refAmount}', '{"cents": 1}')`,
    },
  ];
  for (const probe of jsonProbes) {
    const row = seeded.find((candidate) => candidate.table === probe.table)!;
    const where = whereKey({ key: row.key });
    const [[original]] = (await sequelize.query(
      `SELECT ${quote(probe.column)}::text AS value FROM ${quote(probe.table)} WHERE ${where}`,
    )) as [{ value: string }[], unknown];
    await sequelize.query(`UPDATE ${quote(probe.table)} SET ${quote(probe.column)} = ${probe.jsonSql} WHERE ${where}`);
    await expectRejection({
      run: () => migration.up(queryInterface),
      messageParts: [`"${probe.table}"."${probe.column}"`, String(row.key.id), `"${probe.key}"`],
      label: `up rejects a non-number under ${probe.table}.${probe.column} "${probe.key}"`,
    });
    await sequelize.query(
      `UPDATE ${quote(probe.table)} SET ${quote(probe.column)} = ${sqlLiteral(original.value)}::jsonb WHERE ${where}`,
    );
  }
  await assertState({ expected: 'cents', step: 'after rejected up (json)', rows: seeded });

  await umzug.up({ to: MIGRATION_NAME });
  await assertState({ expected: 'decimal', step: 'up', rows: seeded });
  const upCentsComments = await centsComments({ sequelize });
  check({ ok: upCentsComments.length === 0, label: `up: no money column comment mentions cents (${upCentsComments})` });
  await assertNoUnlistedIntegerColumns({ sequelize, tables, step: 'up' });
  await assertRounding({ sequelize, cases: roundingCases, expected: 'decimal', step: 'up' });

  // A second `up` on converted columns changes nothing, a JPY fraction included.
  const fractionWhere = whereKey({ key: roundingCases[0]!.row.key });
  await sequelize.query(`UPDATE "Transactions" SET "amount" = 1500.5 WHERE ${fractionWhere}`);
  await migration.up(queryInterface);
  const [[fraction]] = (await sequelize.query(
    `SELECT "amount"::numeric = 1500.5 AS ok, "amount"::text AS actual FROM ${quote('Transactions')} WHERE ${fractionWhere}`,
  )) as [{ ok: boolean; actual: string }[], unknown];
  check({ ok: fraction!.ok, label: `second up: leaves a JPY fraction as it is (got ${fraction!.actual})` });
  await sequelize.query(`UPDATE "Transactions" SET "amount" = 1501 WHERE ${fractionWhere}`);
  await assertState({ expected: 'decimal', step: 'second up', rows: seeded });
  await assertRounding({ sequelize, cases: roundingCases, expected: 'decimal', step: 'second up' });

  // A mix of integer and decimal columns makes `up` and `down` refuse before any change.
  const mixedColumn = MONEY_COLUMNS[MONEY_COLUMNS.length - 1];
  const mixedSql = `ALTER TABLE ${quote(mixedColumn.table)} ALTER COLUMN ${quote(mixedColumn.column)}`;
  await sequelize.query(`${mixedSql} TYPE BIGINT USING round(${quote(mixedColumn.column)} * 100)::bigint`);
  for (const direction of ['up', 'down'] as const) {
    await expectRejection({
      run: () => migration[direction](queryInterface),
      messageParts: [`${mixedColumn.table}.${mixedColumn.column} (bigint)`, 'Nothing was changed'],
      label: `${direction} rejects a mix of integer and decimal columns`,
    });
  }
  const otherColumns = seeded.map((row) => ({
    ...row,
    cents: Object.fromEntries(
      Object.entries(row.cents).filter(
        ([column]) => !(row.table === mixedColumn.table && column === mixedColumn.column),
      ),
    ),
  }));
  await assertValues({ sequelize, seeded: otherColumns, expected: 'decimal', step: 'after rejected mixed run' });
  await sequelize.query(
    `${mixedSql} TYPE NUMERIC(${MONEY_COLUMN_PRECISION},${MONEY_COLUMN_SCALE}) USING ${quote(mixedColumn.column)}::numeric / 100`,
  );
  await assertState({ expected: 'decimal', step: 'mixed column restored', rows: seeded });

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
  await assertState({ expected: 'cents', step: 'down', rows: afterDown });
  await assertRounding({ sequelize, cases: roundingCases, expected: 'cents', step: 'down' });
  const downCentsComments = await centsComments({ sequelize });
  check({
    ok: downCentsComments.join() === seedCentsComments.join(),
    label: `down: the cents comments are back (${downCentsComments.length} of ${seedCentsComments.length})`,
  });

  // A second `down` on integer columns changes nothing.
  await migration.down(queryInterface);
  await assertState({ expected: 'cents', step: 'second down', rows: afterDown });

  await umzug.up({ to: MIGRATION_NAME });
  await assertState({ expected: 'decimal', step: 'up-again', rows: afterDown });
  await assertRounding({ sequelize, cases: roundingCases, expected: 'decimal', step: 'up-again' });

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
};

/** Runs every cleanup step; a failure is logged and returned, never thrown, so it cannot hide an earlier error. */
const cleanUp = async ({ steps }: { steps: { label: string; run: () => Promise<unknown> }[] }): Promise<unknown[]> => {
  const errors: unknown[] = [];
  for (const { label, run } of steps) {
    try {
      await run();
    } catch (error) {
      console.error(`Cleanup step "${label}" failed:`, error);
      errors.push(error);
    }
  }
  return errors;
};

const main = async (): Promise<void> => {
  const admin = new Sequelize({ ...connection, database: 'postgres' });
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
  await admin.query(`CREATE DATABASE ${DATABASE_NAME}`);
  await admin.close();

  const sequelize = new Sequelize({ ...connection, database: DATABASE_NAME });
  const migrator = new Sequelize({ ...connection, database: DATABASE_NAME });

  let runError: unknown = null;
  try {
    await runChecks({ sequelize, migrator });
  } catch (error) {
    runError = error;
  }

  const cleanupErrors = await cleanUp({
    steps: [
      { label: 'close connection', run: () => sequelize.close() },
      { label: 'close migrator connection', run: () => migrator.close() },
      {
        label: 'drop database',
        run: async () => {
          const cleanup = new Sequelize({ ...connection, database: 'postgres' });
          try {
            await cleanup.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
          } finally {
            await cleanup.close();
          }
        },
      },
    ],
  });
  if (runError) throw runError;
  if (cleanupErrors.length > 0) throw cleanupErrors[0];

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  if (failures.length > 0) {
    console.log(`\n${passed} checks passed, ${failures.length} failed before the error.`);
    failures.forEach((failure) => console.log(`  - ${failure}`));
  }
  process.exit(1);
});
