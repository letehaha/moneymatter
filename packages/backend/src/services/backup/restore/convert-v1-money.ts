import { type MoneyColumnSpec, type MoneyJsonFieldSpec } from '@common/lib/money-columns';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { MONEY_COLUMNS_20261115, MONEY_JSON_FIELDS_20261115 } from '@root/migrations/utils/money-columns-20261115';
import Big from 'big.js';
import isPlainObject from 'lodash/isPlainObject';

import { BACKUP_TABLES, type BackupFileName, type BackupTableDef } from '../registry';
import { getModelAttributeInfos } from './model-attributes';

type Row = Record<string, unknown>;

/** Format versions below this one carry money as integer cents. */
export const FIRST_DECIMAL_MONEY_FORMAT_VERSION = 4;

const CENTS_PER_UNIT = 100;

interface MoneyColumnRule {
  fileName: BackupFileName;
  /** Model-side name: the key a dumped row uses. */
  attrName: string;
}

interface MoneyJsonRule {
  fileName: BackupFileName;
  /** Model-side name of the JSON column. */
  attrName: string;
  shape: MoneyJsonFieldSpec['shape'];
  path: readonly string[];
  keys: readonly string[];
}

interface V1ConversionRules {
  columns: MoneyColumnRule[];
  jsonFields: MoneyJsonRule[];
}

const tableNameOf = ({ def }: { def: BackupTableDef }): string => String(def.model.getTableName());

/** Resolve a SQL table and column to the backup file and the model attribute that dumps it. */
function resolveColumn({
  table,
  column,
  tables,
}: {
  table: string;
  column: string;
  tables: readonly BackupTableDef[];
}): { fileName: BackupFileName; attrName: string } {
  const def = tables.find((candidate) => tableNameOf({ def: candidate }) === table);
  if (!def) {
    throw new Error(
      `Backup v1 conversion: money table "${table}" is not a backup table, so its cents cannot be converted on restore.`,
    );
  }
  const attribute = getModelAttributeInfos({ model: def.model }).find((info) => info.field === column);
  if (!attribute) {
    throw new Error(`Backup v1 conversion: money column "${table}.${column}" is not an attribute of its model.`);
  }
  return { fileName: def.fileName, attrName: attribute.attrName };
}

/**
 * One conversion rule per column and JSON field that held cents in format versions 1 to 3.
 *
 * Those formats were written before the money-storage migration and format 4 ships with it, so the
 * cents in an old archive sit in exactly the columns that migration converted. Its frozen snapshot
 * is therefore the list to divide, and it never changes. The live `MONEY_COLUMNS` must not be used:
 * a column that was already decimal in those archives may join it later, and every old backup would
 * then restore that column 100 times too small.
 *
 * An entry that cannot be resolved to a backup file and model attribute throws, so a table cannot
 * leave the backup, or a listed column its model, without the converter noticing.
 */
export function buildV1ConversionRules({
  columns = MONEY_COLUMNS_20261115,
  jsonFields = MONEY_JSON_FIELDS_20261115,
  tables = BACKUP_TABLES,
}: {
  columns?: readonly MoneyColumnSpec[];
  jsonFields?: readonly MoneyJsonFieldSpec[];
  tables?: readonly BackupTableDef[];
} = {}): V1ConversionRules {
  return {
    columns: columns.map(({ table, column }) => resolveColumn({ table, column, tables })),
    jsonFields: jsonFields.map(({ table, column, shape, keys, path = [] }) => ({
      ...resolveColumn({ table, column, tables }),
      shape,
      path,
      keys,
    })),
  };
}

let defaultRules: V1ConversionRules | undefined;
const getDefaultRules = (): V1ConversionRules => {
  defaultRules ??= buildV1ConversionRules();
  return defaultRules;
};

/** The legacy cents columns were BIGINT, so no real v1 amount lies outside this range. */
const MAX_LEGACY_CENTS = new Big('9223372036854775807');
const MIN_LEGACY_CENTS = new Big('-9223372036854775808');

/** Plain decimal text without an exponent; the length cap keeps a hostile string from expanding. */
const LEGACY_CENTS_TEXT = /^-?\d{1,24}(\.\d{1,24})?$/;

/**
 * Parse a v1 cents value and divide it by 100. The value is bounded before it reaches big.js:
 * `toFixed()` expands an exponent into that many digits, so an unchecked `1e1000000000` would
 * block the process and exhaust its memory.
 */
function centsToBig({ value, where }: { value: unknown; where: string }): Big {
  const parsable =
    (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number(MAX_LEGACY_CENTS)) ||
    (typeof value === 'string' && LEGACY_CENTS_TEXT.test(value));
  if (parsable) {
    const cents = new Big(value);
    if (cents.gte(MIN_LEGACY_CENTS) && cents.lte(MAX_LEGACY_CENTS)) return cents.div(CENTS_PER_UNIT);
  }
  throw amountNotCentsError({ value, where });
}

const amountNotCentsError = ({ value, where }: { value: unknown; where: string }): ValidationError =>
  new ValidationError({
    message: t({
      key: 'backup.restore.errors.amountNotCents',
      variables: { path: where, value: JSON.stringify(value) },
    }),
  });

/** Cents to the exact decimal string a DECIMAL column takes. */
const centsToDecimalString = ({ value, where }: { value: unknown; where: string }): string =>
  centsToBig({ value, where }).toFixed();

function convertJsonObject({ object, rule, where }: { object: Row; rule: MoneyJsonRule; where: string }): void {
  for (const key of rule.keys) {
    const value = object[key];
    if (value === undefined || value === null) continue;
    // A JSON amount is a number of cents, as the storage migration requires; a string, boolean or
    // object under an amount key is refused, never passed through unconverted.
    if (typeof value !== 'number') throw amountNotCentsError({ value, where });
    object[key] = centsToBig({ value, where }).toNumber();
  }
}

/**
 * Rewrite a format version 1, 2 or 3 archive's money from integer cents to the decimals version 4
 * stores, in place. Covers every column and JSON field the storage migration converts.
 */
export function convertV1MoneyToDecimal({
  data,
  rules = getDefaultRules(),
}: {
  data: Map<BackupFileName, Row[]>;
  rules?: V1ConversionRules;
}): void {
  for (const { fileName, attrName } of rules.columns) {
    for (const row of data.get(fileName) ?? []) {
      const value = row[attrName];
      if (value === undefined || value === null) continue;
      row[attrName] = centsToDecimalString({ value, where: `data/${fileName}.json (${attrName})` });
    }
  }

  for (const rule of rules.jsonFields) {
    const where = `data/${rule.fileName}.json (${rule.attrName})`;
    for (const row of data.get(rule.fileName) ?? []) {
      const field = row[rule.attrName];
      if (rule.shape === 'object') {
        const target = rule.path.reduce<unknown>(
          (node, key) => (isPlainObject(node) ? (node as Row)[key] : undefined),
          field,
        );
        if (isPlainObject(target)) convertJsonObject({ object: target as Row, rule, where });
        continue;
      }
      if (!Array.isArray(field)) continue;
      for (const element of field) {
        if (isPlainObject(element)) convertJsonObject({ object: element as Row, rule, where });
      }
    }
  }
}
