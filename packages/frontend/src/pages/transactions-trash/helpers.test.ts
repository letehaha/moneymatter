import { TRANSACTION_TYPES, type RecordId, type TransactionModel, type TrashEntry } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getExpiringSummary, getOtherLeg, getPrimaryTransaction, getSignedAmount, getTrashDaysLeft } from './helpers';

const NOW = new Date('2026-11-07T12:00:00.000Z');

const buildEntry = (overrides: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 'tx-1' as RecordId,
  deletedAt: '2026-11-01T12:00:00.000Z',
  expiresAt: '2026-12-01T12:00:00.000Z',
  transactions: [{ id: 'tx-1' } as TransactionModel],
  accountNames: {},
  kept: { splits: 0, tags: 0, attachments: 0 },
  links: [],
  ...overrides,
});

describe('getTrashDaysLeft', () => {
  it('rounds a partial day up', () => {
    expect(getTrashDaysLeft({ expiresAt: '2026-11-12T13:00:00.000Z', now: NOW })).toBe(6);
    expect(getTrashDaysLeft({ expiresAt: '2026-11-12T12:00:00.000Z', now: NOW })).toBe(5);
  });

  it('never goes below zero for an entry the purge has not reached yet', () => {
    expect(getTrashDaysLeft({ expiresAt: '2026-11-06T12:00:00.000Z', now: NOW })).toBe(0);
  });
});

describe('getExpiringSummary', () => {
  it('is null when nothing expires within the warning window', () => {
    expect(getExpiringSummary({ entries: [buildEntry()], now: NOW })).toBeNull();
  });

  it('counts expiring entries and reports the furthest deadline among them', () => {
    const entries = [
      buildEntry({ expiresAt: '2026-11-09T12:00:00.000Z' }),
      buildEntry({ expiresAt: '2026-11-14T12:00:00.000Z' }),
      buildEntry({ expiresAt: '2026-11-20T12:00:00.000Z' }),
    ];
    expect(getExpiringSummary({ entries, now: NOW })).toEqual({ count: 2, withinDays: 7 });
  });
});

describe('transfer legs', () => {
  const legs = [{ id: 'tx-2' }, { id: 'tx-1' }] as TransactionModel[];

  it('picks the leg the entry id points at as primary', () => {
    const entry = buildEntry({ transactions: legs });
    expect(getPrimaryTransaction({ entry }).id).toBe('tx-1');
    expect(getOtherLeg({ entry })?.id).toBe('tx-2');
  });

  it('has no other leg for a single row', () => {
    expect(getOtherLeg({ entry: buildEntry() })).toBeNull();
  });
});

describe('getSignedAmount', () => {
  it('negates expenses only', () => {
    const tx = { amount: 12.5 } as TransactionModel;
    expect(getSignedAmount({ transaction: { ...tx, transactionType: TRANSACTION_TYPES.expense } })).toBe(-12.5);
    expect(getSignedAmount({ transaction: { ...tx, transactionType: TRANSACTION_TYPES.income } })).toBe(12.5);
  });
});
