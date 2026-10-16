import { MONEY_COLUMNS, MONEY_JSON_FIELDS } from '@common/lib/money-columns';
import { describe, expect, it } from '@jest/globals';

import { BACKUP_TABLES, type BackupFileName } from '../registry';
import { buildV1ConversionRules, convertV1MoneyToDecimal } from './convert-v1-money';

type Row = Record<string, unknown>;

const rulesFromLists = () => buildV1ConversionRules();

describe('buildV1ConversionRules', () => {
  it('has one rule for every entry of the shared money-column list', () => {
    const rules = rulesFromLists();

    expect(rules.columns).toHaveLength(MONEY_COLUMNS.length);
    expect(rules.jsonFields).toHaveLength(MONEY_JSON_FIELDS.length);
  });

  it('resolves each entry to the backup file whose model owns the table', () => {
    const rules = rulesFromLists();

    MONEY_COLUMNS.forEach(({ table }, index) => {
      const def = BACKUP_TABLES.find((candidate) => candidate.fileName === rules.columns[index]!.fileName);
      expect(String(def!.model.getTableName())).toBe(table);
    });
    MONEY_JSON_FIELDS.forEach(({ table }, index) => {
      const def = BACKUP_TABLES.find((candidate) => candidate.fileName === rules.jsonFields[index]!.fileName);
      expect(String(def!.model.getTableName())).toBe(table);
    });
  });

  it('fails when the list names a table that is not in the backup', () => {
    expect(() =>
      buildV1ConversionRules({ columns: [...MONEY_COLUMNS, { table: 'NotABackupTable', column: 'amount' }] }),
    ).toThrow(/NotABackupTable/);
  });

  it('fails when the list names a column its model does not declare', () => {
    expect(() =>
      buildV1ConversionRules({ columns: [...MONEY_COLUMNS, { table: 'Accounts', column: 'brandNewMoneyColumn' }] }),
    ).toThrow(/Accounts\.brandNewMoneyColumn/);
  });

  it('fails when a JSON field of the list cannot be resolved', () => {
    expect(() =>
      buildV1ConversionRules({
        jsonFields: [...MONEY_JSON_FIELDS, { table: 'Accounts', column: 'noSuchJson', shape: 'object', keys: ['a'] }],
      }),
    ).toThrow(/Accounts\.noSuchJson/);
  });
});

describe('convertV1MoneyToDecimal', () => {
  it('divides every listed column by 100, for every entry of the list', () => {
    const rules = rulesFromLists();
    const data = new Map<BackupFileName, Row[]>();
    for (const { fileName, attrName } of rules.columns) {
      const rows = data.get(fileName) ?? [];
      rows.push({ [attrName]: 123456 });
      data.set(fileName, rows);
    }

    convertV1MoneyToDecimal({ data });

    for (const { fileName, attrName } of rules.columns) {
      const converted = data.get(fileName)!.find((row) => attrName in row);
      expect(converted![attrName]).toBe('1234.56');
    }
  });

  it('converts negatives, zero, sub-unit and very large cents exactly, as decimal strings', () => {
    const data = new Map<BackupFileName, Row[]>([
      [
        'transactions',
        [
          { amount: -2599 },
          { amount: 0 },
          { amount: 1 },
          { amount: 5 },
          { amount: 9007199254740991 },
          { amount: '4200' },
        ],
      ],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('transactions')!.map((row) => row.amount)).toEqual([
      '-25.99',
      '0',
      '0.01',
      '0.05',
      '90071992547409.91',
      '42',
    ]);
  });

  it('keeps null and absent values as they are', () => {
    const data = new Map<BackupFileName, Row[]>([['transactions', [{ amount: 100, refAmount: null }, { note: 'x' }]]]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('transactions')).toEqual([{ amount: '1', refAmount: null }, { note: 'x' }]);
  });

  it('leaves files without a rule untouched', () => {
    const data = new Map<BackupFileName, Row[]>([['categories', [{ name: 'Food', amount: 500 }]]]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('categories')).toEqual([{ name: 'Food', amount: 500 }]);
  });

  it('rejects an amount that is not a number', () => {
    const data = new Map<BackupFileName, Row[]>([['transactions', [{ amount: 'twelve' }]]]);

    expect(() => convertV1MoneyToDecimal({ data })).toThrow(/expected an amount in cents/);
  });

  it('converts the JSON amount keys of an object field and keeps the other entries', () => {
    const data = new Map<BackupFileName, Row[]>([
      ['tag-reminders', [{ settings: { amountThreshold: 150000, note: 'keep', nested: { amountThreshold: 5 } } }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('tag-reminders')).toEqual([
      { settings: { amountThreshold: 1500, note: 'keep', nested: { amountThreshold: 5 } } },
    ]);
  });

  it('converts the amount keys of the nested object a path points to', () => {
    const data = new Map<BackupFileName, Row[]>([
      [
        'venture-event-links',
        [
          { metaData: { originalTransactionState: { amount: 250075, refAmount: 100, note: 'keep' }, amount: 5 } },
          { metaData: null },
          { metaData: { originalTransactionState: 'not-an-object' } },
          { metaData: {} },
        ],
      ],
      ['portfolio-transfers', [{ metaData: { originalTransactionState: { amount: 1999, refAmount: 1999 } } }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('venture-event-links')).toEqual([
      { metaData: { originalTransactionState: { amount: 2500.75, refAmount: 1, note: 'keep' }, amount: 5 } },
      { metaData: null },
      { metaData: { originalTransactionState: 'not-an-object' } },
      { metaData: {} },
    ]);
    expect(data.get('portfolio-transfers')).toEqual([
      { metaData: { originalTransactionState: { amount: 19.99, refAmount: 19.99 } } },
    ]);
  });

  it('converts the amount keys of every element of an array field', () => {
    const data = new Map<BackupFileName, Row[]>([
      [
        'loan-details',
        [
          {
            events: [
              { type: 'planned_payment_change', fromCents: 50000, toCents: 75050, date: '2025-01-01' },
              { type: 'balance_correction', fromCents: null, toCents: 1 },
              { type: 'other' },
              'not-an-object',
            ],
          },
        ],
      ],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('loan-details')).toEqual([
      {
        events: [
          { type: 'planned_payment_change', fromCents: 500, toCents: 750.5, date: '2025-01-01' },
          { type: 'balance_correction', fromCents: null, toCents: 0.01 },
          { type: 'other' },
          'not-an-object',
        ],
      },
    ]);
  });

  it('skips JSON columns that are null or have an unexpected shape', () => {
    const data = new Map<BackupFileName, Row[]>([
      ['tag-reminders', [{ settings: null }, { settings: [1, 2] }, { settings: 'text' }]],
      ['loan-details', [{ events: null }, { events: { fromCents: 100 } }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('tag-reminders')).toEqual([{ settings: null }, { settings: [1, 2] }, { settings: 'text' }]);
    expect(data.get('loan-details')).toEqual([{ events: null }, { events: { fromCents: 100 } }]);
  });
});
