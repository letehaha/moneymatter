import { connection } from '@models/connection';
import { Model, type ModelStatic, type QueryOptions, type Transaction } from 'sequelize';

import type { TableColumnPlan } from './analyze-archive';
import { getFieldMappedAttributes } from './model-attributes';

type Row = Record<string, unknown>;
type AnyModel = ModelStatic<Model>;

/**
 * Project one raw dumped row onto the insert plan's columns, keyed by DB column
 * name (what `bulkInsert` writes). Every plan column is set — missing keys land
 * as NULL — so all records in a batch share one column set. `overrides` carries
 * remapped values (userId, securityId, self-ref parent, credentials).
 */
export function buildInsertRecord({
  row,
  plan,
  overrides,
}: {
  row: Row;
  plan: TableColumnPlan;
  overrides?: Record<string, unknown>;
}): Row {
  const record: Row = {};
  for (const col of plan.columns) {
    record[col.field] = row[col.attrName] ?? null;
  }
  if (overrides) Object.assign(record, overrides);
  return record;
}

/**
 * Insert already-projected records in batches, bypassing the model layer so
 * timestamps and money values land verbatim. Passing the model's field-mapped
 * attributes lets the query generator serialize JSONB / arrays / decimals by
 * their real column types. Callers only feed rows expected to be fresh inserts
 * (wiped user tables; only natural-key-absent catalog securities), so a
 * duplicate-key error is a real corruption signal rather than an expected
 * conflict. Returns the row count.
 */
export async function runBulkInsert({
  model,
  records,
  transaction,
  batchSize = 1000,
}: {
  model: AnyModel;
  records: Row[];
  transaction?: Transaction;
  batchSize?: number;
}): Promise<number> {
  if (records.length === 0) return 0;
  const queryInterface = connection.sequelize.getQueryInterface();
  const fieldAttrs = getFieldMappedAttributes({ model });
  const tableName = model.getTableName();
  const options: QueryOptions = { transaction };

  for (let i = 0; i < records.length; i += batchSize) {
    await queryInterface.bulkInsert(tableName, records.slice(i, i + batchSize), options, fieldAttrs);
  }
  return records.length;
}
