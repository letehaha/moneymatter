import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import { type BackupFileName } from '../registry';
import { findMoneyWithoutCurrencySource, roundMoneyToCurrencyDecimals } from './round-to-currency-decimals';

type Row = Record<string, unknown>;

const digitsByCode = new Map([
  ['USD', 2],
  ['JPY', 0],
  ['KWD', 3],
]);

const round = (entries: [BackupFileName, Row[]][]) => {
  const data = new Map<BackupFileName, Row[]>(entries);
  roundMoneyToCurrencyDecimals({ data, digitsByCode });
  return data;
};

describe('roundMoneyToCurrencyDecimals', () => {
  it('has a currency source for every money column and JSON amount key', () => {
    expect(findMoneyWithoutCurrencySource()).toEqual([]);
  });

  it('rounds native amounts half-up and converted ones half-even, at each currency decimals', () => {
    const data = round([
      ['users-currencies', [{ currencyCode: 'JPY', isDefaultCurrency: true }]],
      ['accounts', [{ id: 7, currencyCode: 'USD', currentBalance: '10.125', refCurrentBalance: '1520.5' }]],
      [
        'transactions',
        [
          { id: 1, currencyCode: 'JPY', refCurrencyCode: 'JPY', amount: '1234.5', refAmount: '1234.5' },
          { id: 2, currencyCode: 'USD', refCurrencyCode: 'JPY', amount: '0.005', refAmount: '1234.5' },
          { id: 3, currencyCode: 'KWD', refCurrencyCode: 'KWD', amount: 1.2345, refAmount: '1.234' },
        ],
      ],
      ['transaction-splits', [{ transactionId: 2, amount: '0.015', refAmount: '2.5' }]],
      ['balances', [{ accountId: 7, amount: '2.5' }]],
      ['budget-plans', [{ id: 'p', currencyCode: 'JPY' }]],
      ['budget-lines', [{ id: 'l', planId: 'p' }]],
      ['budget-line-goals', [{ lineId: 'l', amount: '120.5' }]],
    ]);

    expect(data.get('accounts')).toEqual([
      expect.objectContaining({
        currentBalance: '10.130000000000000000',
        refCurrentBalance: '1520.000000000000000000',
      }),
    ]);
    expect(data.get('transactions')!.map(({ amount, refAmount }) => ({ amount, refAmount }))).toEqual([
      { amount: '1235.000000000000000000', refAmount: '1235.000000000000000000' },
      { amount: '0.010000000000000000', refAmount: '1234.000000000000000000' },
      { amount: '1.235000000000000000', refAmount: '1.234' },
    ]);
    expect(data.get('transaction-splits')).toEqual([
      { transactionId: 2, amount: '0.020000000000000000', refAmount: '2.000000000000000000' },
    ]);
    expect(data.get('balances')).toEqual([{ accountId: 7, amount: '2.000000000000000000' }]);
    expect(data.get('budget-line-goals')).toEqual([{ lineId: 'l', amount: '121.000000000000000000' }]);
  });

  it('leaves an amount whose currency does not resolve, and a positive amount that would round to 0', () => {
    const data = round([
      ['transactions', [{ currencyCode: 'XYZ', amount: '1.23456' }]],
      ['transaction-splits', [{ transactionId: 'missing', amount: '1.23456' }]],
      ['goals', [{ currencyCode: 'JPY', targetAmount: '0.4', achievedAmount: '0.4' }]],
    ]);

    expect(data.get('transactions')).toEqual([{ currencyCode: 'XYZ', amount: '1.23456' }]);
    expect(data.get('transaction-splits')).toEqual([{ transactionId: 'missing', amount: '1.23456' }]);
    expect(data.get('goals')).toEqual([
      { currencyCode: 'JPY', targetAmount: '0.4', achievedAmount: '0.000000000000000000' },
    ]);
  });

  it('rejects an amount whose minor units at its currency decimals exceed the safe integer range', () => {
    expect(() => round([['transactions', [{ currencyCode: 'USD', amount: '100000000000000' }]]])).toThrow(
      ValidationError,
    );
    expect(() => round([['transactions', [{ currencyCode: 'USD', amount: '90000000000000' }]]])).not.toThrow();
  });

  it('rounds JSON amounts as numbers, by the currency of their row or snapshot', () => {
    const data = round([
      ['users-currencies', [{ currencyCode: 'JPY', isDefaultCurrency: true }]],
      ['accounts', [{ id: 'a', currencyCode: 'JPY' }]],
      ['loan-details', [{ accountId: 'a', events: [{ fromCents: 750.5, toCents: null }] }]],
      ['tag-reminders', [{ settings: { amountThreshold: 99.5 } }]],
      [
        'venture-event-links',
        [
          {
            metaData: {
              originalTransactionState: { currencyCode: 'USD', refCurrencyCode: 'JPY', amount: 1.005, refAmount: 2.5 },
            },
          },
        ],
      ],
      [
        'portfolio-transfers',
        [{ metaData: { originalTransactionState: { currencyCode: 'USD', amount: 1.005, refAmount: 2.5 } } }],
      ],
    ]);

    expect(data.get('loan-details')).toEqual([{ accountId: 'a', events: [{ fromCents: 751, toCents: null }] }]);
    expect(data.get('tag-reminders')).toEqual([{ settings: { amountThreshold: 100 } }]);
    expect((data.get('venture-event-links')![0]!.metaData as Row).originalTransactionState).toEqual({
      currencyCode: 'USD',
      refCurrencyCode: 'JPY',
      amount: 1.01,
      refAmount: 2,
    });
    expect((data.get('portfolio-transfers')![0]!.metaData as Row).originalTransactionState).toEqual({
      currencyCode: 'USD',
      amount: 1.01,
      refAmount: 2,
    });
  });
});
