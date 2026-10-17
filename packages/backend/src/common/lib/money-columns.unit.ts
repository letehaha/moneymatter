import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';

import {
  MONEY_COLUMNS_20261016,
  MONEY_COLUMN_PRECISION_20261016,
  MONEY_COLUMN_SCALE_20261016,
  MONEY_JSON_FIELDS_20261016,
} from '../../migrations/utils/money-columns-20261016';
import { MONEY_COLUMNS, MONEY_COLUMN_PRECISION, MONEY_COLUMN_SCALE, MONEY_JSON_FIELDS } from './money-columns';

// `@models/index` builds the Sequelize instance so each model's attributes are populated.
// Dummy connection params make construction succeed without touching a database.
async function loadModels() {
  process.env.APPLICATION_DB_DIALECT ??= 'postgres';
  process.env.APPLICATION_DB_HOST ??= 'localhost';
  process.env.APPLICATION_DB_PORT ??= '5432';
  process.env.APPLICATION_DB_USERNAME ??= 'postgres';
  process.env.APPLICATION_DB_PASSWORD ??= 'postgres';
  process.env.APPLICATION_DB_DATABASE ??= 'money_columns_check';
  await import('@models/index');
  return Object.values(connection.sequelize.models as Record<string, ModelLike>);
}

interface AttributeLike {
  field?: string;
  get?: unknown;
  type: {
    key?: string;
    options?: { precision?: number; scale?: number };
    _precision?: number;
    _scale?: number;
  };
}

interface ModelLike {
  getTableName: () => string | { tableName: string };
  getAttributes: () => Record<string, AttributeLike>;
}

const tableNameOf = (model: ModelLike): string => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

describe('MONEY_COLUMNS', () => {
  // Other fields share the 36,18 shape (e.g. investment quantities), so the list is checked
  // against the declarations one way and the absence of BIGINT money fields the other way.
  it('lists only columns that a model declares as DECIMAL(36,18) money fields', async () => {
    const models = await loadModels();

    const declared = new Set<string>();
    for (const model of models) {
      for (const [name, attribute] of Object.entries(model.getAttributes())) {
        const precision = attribute.type.options?.precision ?? attribute.type._precision;
        const scale = attribute.type.options?.scale ?? attribute.type._scale;
        const isMoneyDecimal =
          attribute.type.key === 'DECIMAL' &&
          Boolean(attribute.get) &&
          precision === MONEY_COLUMN_PRECISION &&
          scale === MONEY_COLUMN_SCALE;
        if (isMoneyDecimal) declared.add(`${tableNameOf(model)}.${attribute.field ?? name}`);
      }
    }

    const listed = MONEY_COLUMNS.map(({ table, column }) => `${table}.${column}`);
    expect(listed.filter((entry) => !declared.has(entry))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('leaves no money field on BIGINT cents storage', async () => {
    const models = await loadModels();

    const cents: string[] = [];
    for (const model of models) {
      for (const [name, attribute] of Object.entries(model.getAttributes())) {
        if (attribute.type.key === 'BIGINT' && attribute.get) cents.push(`${tableNameOf(model)}.${name}`);
      }
    }

    expect(cents).toEqual([]);
  });
});

describe('money-storage migration snapshot', () => {
  // The migration owns a frozen copy of the list, so a column added later never reaches it. The live
  // list starts from that snapshot and only grows: a later column gets its own migration.
  it('keeps every column the migration converted in the live list', () => {
    // `20261019000000-rename-budgets-to-trackers` renamed the "Budgets" table after the snapshot was taken.
    const renamed = MONEY_COLUMNS_20261016.map((entry) =>
      entry.table === 'Budgets' ? { ...entry, table: 'Trackers' } : entry,
    );
    expect(MONEY_COLUMNS).toEqual(expect.arrayContaining(renamed));
    expect(MONEY_JSON_FIELDS).toEqual(expect.arrayContaining([...MONEY_JSON_FIELDS_20261016]));
    expect(MONEY_COLUMN_PRECISION_20261016).toBe(MONEY_COLUMN_PRECISION);
    expect(MONEY_COLUMN_SCALE_20261016).toBe(MONEY_COLUMN_SCALE);
  });
});
