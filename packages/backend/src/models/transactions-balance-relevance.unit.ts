import { describe, expect, it } from '@jest/globals';

import { BalanceRelevantSnapshot, hasBalanceRelevantChange } from './transactions-balance-relevance';

const baseSnapshot = (): BalanceRelevantSnapshot => ({
  accountId: 'acc-1',
  accountType: 'system',
  amount: '125.000000000000000000',
  refAmount: '125.000000000000000000',
  time: new Date('2024-03-15T10:00:00.000Z'),
  transactionType: 'expense',
  currencyCode: 'USD',
  refCurrencyCode: 'USD',
  transferNature: 'not_transfer',
  externalData: null,
});

const withChange = (patch: Partial<BalanceRelevantSnapshot>): BalanceRelevantSnapshot => ({
  ...baseSnapshot(),
  ...patch,
});

describe('hasBalanceRelevantChange', () => {
  it('returns false when nothing changed', () => {
    expect(hasBalanceRelevantChange({ next: baseSnapshot(), prev: baseSnapshot() })).toBe(false);
  });

  it.each([
    ['accountId', { accountId: 'acc-2' }],
    ['accountType', { accountType: 'monobank' }],
    ['amount', { amount: '125.010000000000000000' }],
    ['refAmount', { refAmount: '99.000000000000000000' }],
    ['transactionType', { transactionType: 'income' }],
    ['currencyCode', { currencyCode: 'EUR' }],
    ['refCurrencyCode', { refCurrencyCode: 'EUR' }],
    ['transferNature', { transferNature: 'transfer_to_loan' }],
  ] as [string, Partial<BalanceRelevantSnapshot>][])('returns true when %s changed', (_field, patch) => {
    expect(hasBalanceRelevantChange({ next: withChange(patch), prev: baseSnapshot() })).toBe(true);
  });

  it('treats equal amounts written with a different number of decimals as unchanged', () => {
    const next = withChange({ amount: '125', refAmount: 125 });

    expect(hasBalanceRelevantChange({ next, prev: baseSnapshot() })).toBe(false);
  });

  it('returns true when time moved to another day', () => {
    const next = withChange({ time: new Date('2024-03-16T10:00:00.000Z') });

    expect(hasBalanceRelevantChange({ next, prev: baseSnapshot() })).toBe(true);
  });

  it('returns false for two distinct Date objects holding the same instant', () => {
    const next = withChange({ time: new Date('2024-03-15T10:00:00.000Z') });

    expect(hasBalanceRelevantChange({ next, prev: baseSnapshot() })).toBe(false);
  });

  it('treats an ISO string and an equivalent Date as the same instant', () => {
    const next = withChange({ time: '2024-03-15T10:00:00.000Z' });

    expect(hasBalanceRelevantChange({ next, prev: baseSnapshot() })).toBe(false);
  });

  it('returns true when externalData content changed', () => {
    const prev = withChange({ externalData: { balance: 1000, hold: false } });
    const next = withChange({ externalData: { balance: 2000, hold: false } });

    expect(hasBalanceRelevantChange({ next, prev })).toBe(true);
  });

  it('returns false for structurally identical externalData objects', () => {
    const prev = withChange({ externalData: { balance: 1000, hold: false } });
    const next = withChange({ externalData: { balance: 1000, hold: false } });

    expect(hasBalanceRelevantChange({ next, prev })).toBe(false);
  });

  it('treats null and undefined externalData as unchanged', () => {
    const prev = withChange({ externalData: null });
    const next = withChange({ externalData: undefined });

    expect(hasBalanceRelevantChange({ next, prev })).toBe(false);
  });

  it.each([
    ['note', 'a new note'],
    ['updatedAt', new Date('2024-06-01T00:00:00.000Z')],
    ['categoryId', 'cat-2'],
    ['payeeId', 'payee-2'],
  ] as [string, unknown][])('returns false when only %s changed', (field, value) => {
    const next = { ...baseSnapshot(), [field]: value };
    const prev = { ...baseSnapshot(), [field]: 'original' };

    expect(hasBalanceRelevantChange({ next, prev })).toBe(false);
  });
});
