import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';
import { DataTypes, Sequelize } from 'sequelize';

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

/** Fields that share the money column shape but hold no money amount. */
const NON_MONEY_DECIMAL_FIELDS = ['InvestmentTransactions.quantity'];

const tableNameOf = (model: ModelLike): string => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

const attributesOf = ({ models }: { models: ModelLike[] }) =>
  models.flatMap((model) =>
    Object.entries(model.getAttributes()).map(([name, attribute]) => ({
      id: `${tableNameOf(model)}.${attribute.field ?? name}`,
      attribute,
    })),
  );

/** `Table.column` of every DECIMAL(36,18) attribute with a getter, the shape `@MoneyField` declares. */
const moneyDecimalFields = ({ models }: { models: ModelLike[] }): string[] =>
  attributesOf({ models })
    .filter(({ attribute }) => {
      const precision = attribute.type.options?.precision ?? attribute.type._precision;
      const scale = attribute.type.options?.scale ?? attribute.type._scale;
      return (
        attribute.type.key === 'DECIMAL' &&
        Boolean(attribute.get) &&
        precision === MONEY_COLUMN_PRECISION &&
        scale === MONEY_COLUMN_SCALE
      );
    })
    .map(({ id }) => id);

const bigintFields = ({ models }: { models: ModelLike[] }): string[] =>
  attributesOf({ models })
    .filter(({ attribute }) => attribute.type.key === 'BIGINT')
    .map(({ id }) => id);

function getter(this: { getDataValue: (key: string) => unknown }) {
  return this.getDataValue('value');
}

/** A model built the way Sequelize builds the real ones, holding one field of each shape the detectors look for. */
const probeModels = (): ModelLike[] => {
  const sequelize = new Sequelize({ dialect: 'postgres' });
  const probe = sequelize.define(
    'Probe',
    {
      cents: { type: DataTypes.BIGINT, get: getter },
      plainCents: { type: DataTypes.BIGINT },
      amount: { type: DataTypes.DECIMAL(MONEY_COLUMN_PRECISION, MONEY_COLUMN_SCALE), get: getter },
      ratio: { type: DataTypes.DECIMAL(20, 10), get: getter },
    },
    { tableName: 'Probes', timestamps: false },
  );
  return [probe as unknown as ModelLike];
};

describe('MONEY_COLUMNS', () => {
  it('detects the money decimal shape and BIGINT fields on a model built by Sequelize', () => {
    const models = probeModels();

    expect(moneyDecimalFields({ models })).toEqual(['Probes.amount']);
    expect(bigintFields({ models })).toEqual(['Probes.cents', 'Probes.plainCents']);
  });

  it('lists exactly the DECIMAL(36,18) money fields the models declare', async () => {
    const models = await loadModels();
    const declared = moneyDecimalFields({ models });

    const listed = MONEY_COLUMNS.map(({ table, column }) => `${table}.${column}`);
    expect(new Set(listed).size).toBe(listed.length);
    expect(NON_MONEY_DECIMAL_FIELDS.filter((entry) => !declared.includes(entry))).toEqual([]);
    expect(declared.filter((entry) => !NON_MONEY_DECIMAL_FIELDS.includes(entry)).toSorted()).toEqual(listed.toSorted());
  });

  it('leaves no field on BIGINT storage', async () => {
    const models = await loadModels();

    expect(bigintFields({ models })).toEqual([]);
  });
});

describe('MONEY_JSON_FIELDS', () => {
  it('names a JSON attribute of a model for every entry', async () => {
    const models = await loadModels();
    const jsonFields = attributesOf({ models })
      .filter(({ attribute }) => attribute.type.key === 'JSONB' || attribute.type.key === 'JSON')
      .map(({ id }) => id);

    const listed = MONEY_JSON_FIELDS.map(({ table, column }) => `${table}.${column}`);
    expect(listed.filter((entry) => !jsonFields.includes(entry))).toEqual([]);
  });
});
