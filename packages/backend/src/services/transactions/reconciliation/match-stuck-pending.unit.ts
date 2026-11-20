import { RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { matchStuckPending, type StuckPendingMatchRow } from './match-stuck-pending';

const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date('2026-01-10T00:00:00Z').getTime();

const row = ({
  id,
  accountId = 'acc-1',
  ...overrides
}: Partial<Omit<StuckPendingMatchRow, 'id' | 'accountId'>> & {
  id: string;
  accountId?: string;
}): StuckPendingMatchRow => ({
  id: id as RecordId,
  accountId: accountId as RecordId,
  transactionType: TRANSACTION_TYPES.expense,
  time: new Date(BASE),
  amount: Money.fromDecimal(10),
  payeeId: null,
  merchantName: 'Coffee Shop',
  ...overrides,
});

describe('matchStuckPending', () => {
  it('pairs a pending row with a booked copy of the same payee within 5 days', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p1' })],
      pool: [row({ id: 'c1', time: new Date(BASE + 2 * DAY), merchantName: '  coffee   SHOP ' })],
    });

    expect(matches.get('p1' as RecordId)).toBe('c1');
  });

  it('ignores candidates outside the window, on another account, of another type or payee', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p1' })],
      pool: [
        row({ id: 'before', time: new Date(BASE - DAY) }),
        row({ id: 'late', time: new Date(BASE + 6 * DAY) }),
        row({ id: 'account', accountId: 'acc-2' }),
        row({ id: 'type', transactionType: TRANSACTION_TYPES.income }),
        row({ id: 'payee', merchantName: 'Bakery' }),
      ],
    });

    expect(matches.size).toBe(0);
  });

  it('compares payeeId when both sides have one, merchant name otherwise', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p1', payeeId: 'payee-a' }), row({ id: 'p2', payeeId: 'payee-a', merchantName: null })],
      pool: [
        row({ id: 'other-payee', payeeId: 'payee-b' }),
        row({ id: 'no-payee', payeeId: null, merchantName: 'Coffee Shop' }),
      ],
    });

    expect(matches.get('p1' as RecordId)).toBe('no-payee');
    expect(matches.has('p2' as RecordId)).toBe(false);
  });

  it('assigns one-to-one by smallest amount difference, then time difference', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p1', amount: Money.fromDecimal(10) }), row({ id: 'p2', amount: Money.fromDecimal(15) })],
      pool: [
        row({ id: 'c-exact', amount: Money.fromDecimal(10), time: new Date(BASE + 3 * DAY) }),
        row({ id: 'c-near', amount: Money.fromDecimal(10), time: new Date(BASE + DAY) }),
      ],
    });

    expect(matches.get('p1' as RecordId)).toBe('c-near');
    expect(matches.get('p2' as RecordId)).toBe('c-exact');
  });

  it('matches globally by smallest difference, not per pending row in list order', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p1', amount: Money.fromDecimal(10) }), row({ id: 'p2', amount: Money.fromDecimal(11) })],
      pool: [row({ id: 'c1', amount: Money.fromDecimal(11) }), row({ id: 'c2', amount: Money.fromDecimal(12) })],
    });

    expect(matches.get('p2' as RecordId)).toBe('c1');
    expect(matches.get('p1' as RecordId)).toBe('c2');
  });

  it('ranks by the amount difference at every decimal the currency carries', () => {
    // A 3-decimal currency: both candidates round to the same cent, only the exact one has no difference.
    const matches = matchStuckPending({
      pending: [row({ id: 'p1', amount: Money.fromDecimal('1.001') })],
      pool: [
        row({ id: 'c-off', amount: Money.fromDecimal('1.004'), time: new Date(BASE + DAY) }),
        row({ id: 'c-exact', amount: Money.fromDecimal('1.001'), time: new Date(BASE + 3 * DAY) }),
      ],
    });

    expect(matches.get('p1' as RecordId)).toBe('c-exact');
  });

  it('never matches rows that have neither a payee nor a usable merchant name', () => {
    const matches = matchStuckPending({
      pending: [row({ id: 'p-null', merchantName: null }), row({ id: 'p-blank', merchantName: '  ' })],
      pool: [row({ id: 'c-null', merchantName: null }), row({ id: 'c-blank', merchantName: '  ' })],
    });

    expect(matches.size).toBe(0);
  });
});
