import { describe, expect, it } from '@jest/globals';

import { buildCardTarget } from './card-target';

const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';

const COFFEE = {
  id: '01a15310-0000-4000-8000-000000000001',
  amount: 28.1,
  currencyCode: 'GEL',
  time: '2026-10-19T07:26:00.000Z',
  note: 'Nord Coffee',
  accountId: ID,
  payeeId: ID,
  categoryId: ID,
  transactionType: 'expense',
  userId: 7,
};

describe('buildCardTarget', () => {
  it('identifies a transaction by amount with currency, time, note, payee, account, category and type', () => {
    const target = buildCardTarget({ before: COFFEE });

    expect(target.map((field) => field.path)).toEqual([
      'amount',
      'time',
      'note',
      'payeeId',
      'accountId',
      'categoryId',
      'transactionType',
    ]);
    expect(target[0]).toMatchObject({ value: 28.1, display: { kind: 'money', currencyCode: 'GEL' }, editable: null });
    expect(target[1]).toMatchObject({ value: COFFEE.time, display: { kind: 'datetime' } });
    expect(target[3]).toMatchObject({ value: ID, display: { kind: 'entity', entity: { kind: 'payee', id: ID } } });
    expect(target[6]).toMatchObject({ display: { kind: 'enum' } });
  });

  it('reads a money amount stored as text', () => {
    const [amount] = buildCardTarget({ before: { amount: '12.50', currencyCode: 'USD' } });

    expect(amount).toMatchObject({ path: 'amount', value: 12.5, display: { kind: 'money', currencyCode: 'USD' } });
  });

  it('identifies a payee, a category or an account by its name', () => {
    expect(buildCardTarget({ before: { id: ID, name: 'Nord Coffee', userId: 1 } }).map((field) => field.path)).toEqual([
      'name',
    ]);
  });

  it('shows the currency of a record that has no amount, such as an account', () => {
    const target = buildCardTarget({ before: { name: 'Cash', currencyCode: 'GEL' } });

    expect(target.map((field) => field.path)).toEqual(['name', 'currencyCode']);
  });

  it.each([
    [
      'a subscription',
      { name: 'Netflix', expectedAmount: 12.99, expectedCurrencyCode: 'USD', frequency: 'monthly' },
      ['name', 'expectedAmount'],
    ],
    ['a tag reminder', { type: 'monthly', frequency: 'month' }, ['type']],
    ['a payee alias', { rawName: 'NORD COFFEE TBILISI' }, ['rawName']],
    ['an attachment', { filename: 'receipt.pdf', size: 10 }, ['filename']],
    ['a vehicle', { make: 'Toyota', model: 'Corolla', year: 2018 }, ['make', 'model']],
    ['a loan', { lenderName: 'TBC', startDate: '2026-01-01' }, ['lenderName', 'startDate']],
    [
      'a venture event',
      { type: 'distribution', eventDate: '2026-05-01', grossAmount: 100, currencyCode: 'USD' },
      ['grossAmount', 'eventDate'],
    ],
    [
      'an investment transaction',
      { name: 'AAPL buy', date: '2026-05-01', amount: 100, currencyCode: 'USD' },
      ['name', 'amount', 'date'],
    ],
  ])('identifies %s', (_name, before, paths) => {
    expect(buildCardTarget({ before }).map((field) => field.path)).toEqual(paths);
  });

  it('leaves out empty fields', () => {
    const target = buildCardTarget({ before: { name: 'Wallet', note: null, description: '' } });

    expect(target.map((field) => field.path)).toEqual(['name']);
  });

  it('has nothing for a record that does not exist yet', () => {
    expect(buildCardTarget({ before: null })).toEqual([]);
    expect(buildCardTarget({ before: undefined })).toEqual([]);
  });
});
