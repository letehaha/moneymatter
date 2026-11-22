import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import {
  MONEY_COLUMNS_20261115 as MONEY_COLUMNS,
  MONEY_JSON_FIELDS_20261115 as MONEY_JSON_FIELDS,
} from '@root/migrations/utils/money-columns-20261115';

import { BACKUP_TABLES, type BackupFileName } from '../registry';
import { assertDecimalMoney, buildV1ConversionRules, convertV1MoneyToDecimal } from './convert-v1-money';

type Row = Record<string, unknown>;

const rulesFromLists = () => buildV1ConversionRules();

const amountNotCents = ({ path, value }: { path: string; value: unknown }): string =>
  t({ key: 'backup.restore.errors.amountNotCents', variables: { path, value: JSON.stringify(value) } });

describe('buildV1ConversionRules', () => {
  it('has one rule for every entry of the frozen list of columns that held cents', () => {
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

  it('converts negatives, zero, sub-unit, very large cents and the BIGINT bounds exactly, as decimal strings', () => {
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
          { amount: '9223372036854775807' },
          { amount: '-9223372036854775808' },
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
      '92233720368547758.07',
      '-92233720368547758.08',
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

  it.each([
    ['a non-numeric string', 'twelve'],
    ['an exponent string', '1e1000000000'],
    ['a huge exponent number', 1e300],
    ['a number past the BIGINT range', 9.3e18],
    ['a string past the BIGINT range', '9223372036854775808'],
    ['an infinite number', Infinity],
    ['a string with a long fraction', `0.${'1'.repeat(1000)}`],
    ['fractional cents a BIGINT column never held', 1550.5],
    ['fractional cents as text', '1550.5'],
  ])('rejects a hostile v1 column amount (%s) before expanding it', (_label, amount) => {
    const data = new Map<BackupFileName, Row[]>([['transactions', [{ amount }]]]);

    expect(() => convertV1MoneyToDecimal({ data })).toThrow(
      amountNotCents({ path: 'data/transactions.json (amount)', value: amount }),
    );
  });

  it.each([
    ['a numeric string', '150000'],
    ['a boolean', true],
    ['an object', { cents: 150000 }],
    ['a huge exponent number', 1e300],
  ])('rejects %s under a JSON amount key, as the storage migration does', (_label, amountThreshold) => {
    const data = new Map<BackupFileName, Row[]>([['tag-reminders', [{ settings: { amountThreshold } }]]]);

    expect(() => convertV1MoneyToDecimal({ data })).toThrow(
      amountNotCents({ path: 'data/tag-reminders.json (settings)', value: amountThreshold }),
    );
  });

  it('keeps a null or absent JSON amount key as it is', () => {
    const data = new Map<BackupFileName, Row[]>([
      ['tag-reminders', [{ settings: { amountThreshold: null } }, { settings: { note: 'none' } }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('tag-reminders')).toEqual([
      { settings: { amountThreshold: null } },
      { settings: { note: 'none' } },
    ]);
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
          { metaData: {} },
        ],
      ],
      ['portfolio-transfers', [{ metaData: { originalTransactionState: { amount: 1999, refAmount: 1999 } } }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('venture-event-links')).toEqual([
      { metaData: { originalTransactionState: { amount: 2500.75, refAmount: 1, note: 'keep' }, amount: 5 } },
      { metaData: null },
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

  it('skips JSON columns that are null', () => {
    const data = new Map<BackupFileName, Row[]>([
      ['tag-reminders', [{ settings: null }]],
      ['loan-details', [{ events: null }]],
    ]);

    convertV1MoneyToDecimal({ data });

    expect(data.get('tag-reminders')).toEqual([{ settings: null }]);
    expect(data.get('loan-details')).toEqual([{ events: null }]);
  });

  it.each<[BackupFileName, Row, string, unknown]>([
    ['tag-reminders', { settings: [1, 2] }, 'data/tag-reminders.json (settings)', [1, 2]],
    ['tag-reminders', { settings: 'text' }, 'data/tag-reminders.json (settings)', 'text'],
    ['loan-details', { events: { fromCents: 100 } }, 'data/loan-details.json (events)', { fromCents: 100 }],
    [
      'venture-event-links',
      { metaData: { originalTransactionState: 'not-an-object' } },
      'data/venture-event-links.json (metaData)',
      'not-an-object',
    ],
  ])('refuses a %s JSON column of the wrong type', (fileName, row, path, value) => {
    const data = new Map<BackupFileName, Row[]>([[fileName, [row]]]);

    expect(() => convertV1MoneyToDecimal({ data })).toThrow(amountNotCents({ path, value }));
  });
});

describe('assertDecimalMoney', () => {
  it('accepts the decimals a format version 4 archive stores', () => {
    const data = new Map<BackupFileName, Row[]>([
      ['transactions', [{ amount: '15.500000000000000000', refAmount: -3, commissionRate: null }]],
      ['loan-details', [{ events: [{ fromCents: 5.25, toCents: '-999999999999999999.123' }] }]],
    ]);

    expect(() => assertDecimalMoney({ data })).not.toThrow();
  });

  it.each(['NaN', 'Infinity', '1e30', '1234567890123456789', '1.1234567890123456789', ' 1', 1e18, Infinity, true])(
    'refuses %p as a column amount',
    (value) => {
      const data = new Map<BackupFileName, Row[]>([['transactions', [{ amount: value }]]]);

      expect(() => assertDecimalMoney({ data })).toThrow(
        amountNotCents({ path: 'data/transactions.json (amount)', value }),
      );
    },
  );

  it('refuses a JSON amount the column cannot hold', () => {
    const data = new Map<BackupFileName, Row[]>([['tag-reminders', [{ settings: { amountThreshold: 1e30 } }]]]);

    expect(() => assertDecimalMoney({ data })).toThrow(
      amountNotCents({ path: 'data/tag-reminders.json (settings)', value: 1e30 }),
    );
  });
});
