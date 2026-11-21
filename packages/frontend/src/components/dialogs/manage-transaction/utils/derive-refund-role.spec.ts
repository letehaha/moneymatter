import { TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import type { RefundWithSplit } from '../types';
import { deriveRefundRole, deriveRowRefundRole, isDatedAfterPivotDay } from './derive-refund-role';

const currentTime = new Date(2026, 4, 15, 14, 30);
const dayBefore = new Date(2026, 4, 14, 23, 59);
const sameDayMorning = new Date(2026, 4, 15, 0, 0);
const dayAfter = new Date(2026, 4, 16, 0, 0);

const row = ({ time, type }: { time: Date | string; type: TRANSACTION_TYPES }) =>
  ({ time, transactionType: type }) as Pick<TransactionModel, 'time' | 'transactionType'>;
const income = (time: Date | string) => row({ time, type: TRANSACTION_TYPES.income });
const expense = (time: Date | string) => row({ time, type: TRANSACTION_TYPES.expense });

const savedLink = { transaction: { id: 'saved' } } as RefundWithSplit;

const unsaved = { savedRefunds: undefined, savedRefundedBy: undefined, isRecordCreation: false, currentTime };

describe('deriveRowRefundRole', () => {
  it('treats an earlier row as the original, so the current entry is the refund', () => {
    expect(deriveRowRefundRole({ row: income(dayBefore), currentTime })).toBe('refund');
    expect(deriveRowRefundRole({ row: expense(dayBefore), currentTime })).toBe('refund');
  });

  it('treats a later row as the refund, so the current entry is the original', () => {
    expect(deriveRowRefundRole({ row: income(dayAfter), currentTime })).toBe('original');
    expect(deriveRowRefundRole({ row: expense(dayAfter), currentTime })).toBe('original');
  });

  it('makes the expense the original on a same-day tie', () => {
    expect(deriveRowRefundRole({ row: expense(sameDayMorning), currentTime })).toBe('refund');
    expect(deriveRowRefundRole({ row: income(sameDayMorning), currentTime })).toBe('original');
  });

  it('compares local calendar days, not timestamps', () => {
    const laterSameDay = new Date(2026, 4, 15, 23, 59);
    expect(deriveRowRefundRole({ row: income(laterSameDay), currentTime })).toBe('original');
    expect(deriveRowRefundRole({ row: expense(laterSameDay), currentTime })).toBe('refund');
  });

  it('accepts an ISO string row time', () => {
    expect(deriveRowRefundRole({ row: income(dayBefore.toISOString()), currentTime })).toBe('refund');
  });
});

describe('deriveRefundRole', () => {
  it('is null until the first tick when nothing is saved', () => {
    expect(deriveRefundRole({ ...unsaved, firstTicked: null })).toBeNull();
    expect(deriveRefundRole({ ...unsaved, firstTicked: undefined })).toBeNull();
  });

  it('lets the first ticked row decide by date', () => {
    expect(deriveRefundRole({ ...unsaved, firstTicked: expense(dayBefore) })).toBe('refund');
    expect(deriveRefundRole({ ...unsaved, firstTicked: income(dayAfter) })).toBe('original');
    expect(deriveRefundRole({ ...unsaved, firstTicked: expense(sameDayMorning) })).toBe('refund');
    expect(deriveRefundRole({ ...unsaved, firstTicked: income(sameDayMorning) })).toBe('original');
  });

  it('keeps saved refunds links on the refund side whatever the dates say', () => {
    expect(deriveRefundRole({ ...unsaved, savedRefunds: [savedLink], firstTicked: income(dayAfter) })).toBe('refund');
    expect(deriveRefundRole({ ...unsaved, savedRefunds: [savedLink], firstTicked: null })).toBe('refund');
  });

  it('keeps saved refunded-by links on the original side whatever the dates say', () => {
    expect(deriveRefundRole({ ...unsaved, savedRefundedBy: [savedLink], firstTicked: expense(dayBefore) })).toBe(
      'original',
    );
    expect(deriveRefundRole({ ...unsaved, savedRefundedBy: [savedLink], firstTicked: null })).toBe('original');
  });

  it('gives saved refunds precedence over saved refunded-by', () => {
    expect(
      deriveRefundRole({ ...unsaved, savedRefunds: [savedLink], savedRefundedBy: [savedLink], firstTicked: null }),
    ).toBe('refund');
  });

  it('fixes the refund side for an external link', () => {
    expect(deriveRefundRole({ ...unsaved, hasExternalLink: true, firstTicked: income(dayAfter) })).toBe('refund');
    expect(deriveRefundRole({ ...unsaved, hasExternalLink: true, firstTicked: null })).toBe('refund');
  });

  it('fixes the refund side on record creation', () => {
    expect(deriveRefundRole({ ...unsaved, isRecordCreation: true, firstTicked: null })).toBe('refund');
    expect(deriveRefundRole({ ...unsaved, isRecordCreation: true, firstTicked: income(dayAfter) })).toBe('refund');
  });

  it('ignores cleared and empty saved sides', () => {
    expect(deriveRefundRole({ ...unsaved, savedRefunds: null, savedRefundedBy: [], firstTicked: null })).toBeNull();
  });
});

describe('isDatedAfterPivotDay', () => {
  it('is true only for rows on a later local day', () => {
    expect(isDatedAfterPivotDay({ rowTime: dayAfter, currentTime })).toBe(true);
    expect(isDatedAfterPivotDay({ rowTime: new Date(2026, 4, 15, 23, 59), currentTime })).toBe(false);
    expect(isDatedAfterPivotDay({ rowTime: dayBefore.toISOString(), currentTime })).toBe(false);
  });
});
