import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';

import { CURRENCY_CODE_COLUMNS, CURRENCY_CODE_MAX_LENGTH, NULLABLE_REF_COLUMNS } from './currency-code-columns';

// `@models/index` builds the Sequelize instance so each model's attributes are populated.
// Dummy connection params make construction succeed without touching a database.
async function loadModels() {
  process.env.APPLICATION_DB_DIALECT ??= 'postgres';
  process.env.APPLICATION_DB_HOST ??= 'localhost';
  process.env.APPLICATION_DB_PORT ??= '5432';
  process.env.APPLICATION_DB_USERNAME ??= 'postgres';
  process.env.APPLICATION_DB_PASSWORD ??= 'postgres';
  process.env.APPLICATION_DB_DATABASE ??= 'currency_code_columns_check';
  await import('@models/index');
  return Object.values(connection.sequelize.models as Record<string, ModelLike>);
}

interface AttributeLike {
  field?: string;
  allowNull?: boolean;
  type: { key?: string; options?: { length?: number }; _length?: number };
}

interface ModelLike {
  getTableName: () => string | { tableName: string };
  getAttributes: () => Record<string, AttributeLike>;
}

const tableNameOf = (model: ModelLike): string => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

const lengthOf = (attribute: AttributeLike): number | undefined =>
  attribute.type.options?.length ?? attribute.type._length;

describe('CURRENCY_CODE_COLUMNS', () => {
  it('lists only columns that a model declares as varchar(CURRENCY_CODE_MAX_LENGTH)', async () => {
    const models = await loadModels();

    const declared = new Set<string>();
    for (const model of models) {
      for (const [name, attribute] of Object.entries(model.getAttributes())) {
        if (attribute.type.key === 'STRING' && lengthOf(attribute) === CURRENCY_CODE_MAX_LENGTH) {
          declared.add(`${tableNameOf(model)}.${attribute.field ?? name}`);
        }
      }
    }

    const listed = CURRENCY_CODE_COLUMNS.map(({ table, column }) => `${table}.${column}`);
    expect(listed.filter((entry) => !declared.has(entry))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('leaves no model declaring a varchar(3) column', async () => {
    const models = await loadModels();

    const narrow: string[] = [];
    for (const model of models) {
      for (const [name, attribute] of Object.entries(model.getAttributes())) {
        if (attribute.type.key === 'STRING' && lengthOf(attribute) === 3) {
          narrow.push(`${tableNameOf(model)}.${name}`);
        }
      }
    }

    expect(narrow).toEqual([]);
  });
});

describe('NULLABLE_REF_COLUMNS', () => {
  it('lists only columns that a model declares nullable', async () => {
    const models = await loadModels();

    const nullable = new Set<string>();
    for (const model of models) {
      for (const [name, attribute] of Object.entries(model.getAttributes())) {
        if (attribute.allowNull === true) nullable.add(`${tableNameOf(model)}.${attribute.field ?? name}`);
      }
    }

    const listed = NULLABLE_REF_COLUMNS.map(({ table, column }) => `${table}.${column}`);
    expect(listed.filter((entry) => !nullable.has(entry))).toEqual([]);
  });
});
