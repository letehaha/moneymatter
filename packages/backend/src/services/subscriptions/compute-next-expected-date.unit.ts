import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { computeNextExpectedDate, resolveNextExpectedDate } from './subscription-date.utils';

const FROZEN_NOW = new Date('2025-06-15T12:00:00Z');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FROZEN_NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

describe('computeNextExpectedDate', () => {
  describe('without transactions', () => {
    it('returns the next weekly date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-14T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      });
      expect(result).toBe('2025-06-21');
    });

    it('returns the next biweekly date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.biweekly,
      });
      expect(result).toBe('2025-06-29');
    });

    it('returns the next monthly date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-05-20T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      });
      expect(result).toBe('2025-06-20');
    });

    it('returns the next quarterly date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-01-10T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.quarterly,
      });
      expect(result).toBe('2025-07-10');
    });

    it('returns the next semi-annual date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2024-12-20T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.semiAnnual,
      });
      expect(result).toBe('2025-06-20');
    });

    it('returns the next annual date from startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2024-07-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.annual,
      });
      expect(result).toBe('2025-07-01');
    });

    it('advances past multiple periods when startDate is far in the past', () => {
      const result = computeNextExpectedDate({
        startDate: '2023-01-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      });
      expect(result).toBe('2025-07-01');
    });
  });

  describe('with transactions', () => {
    it('advances from the latest transaction date instead of startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2024-01-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [{ time: '2025-05-10T00:00:00Z' }, { time: '2025-06-10T00:00:00Z' }],
      });
      expect(result).toBe('2025-07-10');
    });

    it('uses the latest transaction when they are out of order', () => {
      const result = computeNextExpectedDate({
        startDate: '2024-01-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [
          { time: '2025-06-10T00:00:00Z' },
          { time: '2025-04-10T00:00:00Z' },
          { time: '2025-05-10T00:00:00Z' },
        ],
      });
      expect(result).toBe('2025-07-10');
    });

    it('ignores transactions with null/undefined time', () => {
      const result = computeNextExpectedDate({
        startDate: '2024-01-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [{ time: undefined }, { time: '2025-06-01T00:00:00Z' }],
      });
      expect(result).toBe('2025-07-01');
    });

    it('falls back to startDate when all transaction times are null', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [{ time: undefined }, { time: undefined }],
      });
      expect(result).toBe('2025-07-01');
    });

    it('falls back to startDate when transactions array is empty', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [],
      });
      expect(result).toBe('2025-07-01');
    });
  });

  describe('future startDate', () => {
    it('returns the startDate itself when it is in the future', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-18T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      });
      expect(result).toBe('2025-06-18');
    });

    it('returns the startDate itself when it is today', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-15T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      });
      expect(result).toBe('2025-06-15');
    });

    it('returns the future startDate regardless of frequency', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-18T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      });
      expect(result).toBe('2025-06-18');
    });

    it('returns the future startDate when all transaction times are null', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-07-01T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [{ time: undefined }, { time: undefined }],
      });
      expect(result).toBe('2025-07-01');
    });

    it('advances from the transaction date when one exists, ignoring the future startDate', () => {
      const result = computeNextExpectedDate({
        startDate: '2025-06-18T00:00:00Z',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        transactions: [{ time: '2025-05-20T00:00:00Z' }],
      });
      expect(result).toBe('2025-06-20');
    });
  });
});

describe('resolveNextExpectedDate', () => {
  const base = {
    startDate: '2025-01-08T00:00:00Z',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    isActive: true,
    endDate: null,
    dueDate: null,
  };

  describe('with a schedule', () => {
    it('prefers the open period dueDate over the payment-based estimate', () => {
      const result = resolveNextExpectedDate({
        ...base,
        openPeriodDueDate: '2025-07-08',
        dueDate: '2025-07-08',
        transactions: [{ time: '2025-06-06T00:00:00Z' }],
      });
      expect(result).toBe('2025-07-08');
    });

    it('keeps a past open period dueDate as is (overdue)', () => {
      const result = resolveNextExpectedDate({ ...base, dueDate: '2025-06-01', openPeriodDueDate: '2025-06-01' });
      expect(result).toBe('2025-06-01');
    });

    it('is null once the schedule has no open period left', () => {
      const result = resolveNextExpectedDate({
        ...base,
        dueDate: '2025-03-08',
        openPeriodDueDate: null,
        transactions: [{ time: '2025-06-06T00:00:00Z' }],
      });
      expect(result).toBeNull();
    });
  });

  describe('without a schedule', () => {
    it('keeps the payment-based estimate', () => {
      const result = resolveNextExpectedDate({ ...base, transactions: [{ time: '2025-06-06T00:00:00Z' }] });
      expect(result).toBe('2025-07-06');
    });
  });

  describe('inactive and ended subscriptions', () => {
    it('is null when the subscription is inactive', () => {
      expect(
        resolveNextExpectedDate({ ...base, isActive: false, dueDate: '2025-07-08', openPeriodDueDate: '2025-07-08' }),
      ).toBeNull();
    });

    it('is null when the endDate is before the next date', () => {
      const result = resolveNextExpectedDate({
        ...base,
        endDate: '2025-06-01',
        dueDate: '2025-07-08',
        openPeriodDueDate: '2025-07-08',
      });
      expect(result).toBeNull();
    });

    it('is null for a payment-based estimate past the endDate', () => {
      const result = resolveNextExpectedDate({
        ...base,
        endDate: '2025-06-20',
        transactions: [{ time: '2025-06-06T00:00:00Z' }],
      });
      expect(result).toBeNull();
    });

    it('keeps the date when it falls exactly on the endDate', () => {
      const result = resolveNextExpectedDate({
        ...base,
        endDate: '2025-07-08',
        dueDate: '2025-07-08',
        openPeriodDueDate: '2025-07-08',
      });
      expect(result).toBe('2025-07-08');
    });
  });
});
