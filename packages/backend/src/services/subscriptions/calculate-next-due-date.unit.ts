// calculateNextDueDate is the sole due-date generator on both the pay and skip
// paths. These tests lock every branch: fixed offsets for day-based frequencies,
// month-end clamp-down, and the snap-back guarantee (anchorDay, not the prior
// clamped day, is always the source of truth for the next month's day).

import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { calculateNextDueDate } from './calculate-next-due-date';

describe('calculateNextDueDate', () => {
  describe('fixed-offset frequencies (no clamp)', () => {
    it('weekly: adds exactly 7 days', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.weekly,
        anchorDay: 15,
      });
      expect(result).toBe('2026-06-22');
    });

    it('biweekly: adds exactly 14 days', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.biweekly,
        anchorDay: 15,
      });
      expect(result).toBe('2026-06-29');
    });

    it('monthly: adds 1 month from mid-month (no clamp needed)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 15,
      });
      expect(result).toBe('2026-07-15');
    });

    it('quarterly: adds 3 months from mid-month (no clamp needed)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.quarterly,
        anchorDay: 15,
      });
      expect(result).toBe('2026-09-15');
    });

    it('semiAnnual: adds 6 months from mid-month (no clamp needed)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.semiAnnual,
        anchorDay: 15,
      });
      expect(result).toBe('2026-12-15');
    });

    it('annual: adds 12 months from mid-month (no clamp needed)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-06-15',
        frequency: SUBSCRIPTION_FREQUENCIES.annual,
        anchorDay: 15,
      });
      expect(result).toBe('2027-06-15');
    });
  });

  describe('month-end clamp-down', () => {
    it('monthly: Jan 31 + anchorDay 31 -> Feb 28 (2026 is not a leap year)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-01-31',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 31,
      });
      expect(result).toBe('2026-02-28');
    });

    it('monthly: Jan 30 + anchorDay 30 -> Feb 28', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-01-30',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 30,
      });
      expect(result).toBe('2026-02-28');
    });
  });

  describe('snap-back guarantee (anchorDay is source of truth)', () => {
    it('monthly: Feb 28 + anchorDay 31 -> Mar 31 (NOT Mar 28)', () => {
      // After a clamp to Feb 28, the next month must snap back to anchorDay 31,
      // not carry the clamped day forward.
      const result = calculateNextDueDate({
        currentDueDate: '2026-02-28',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 31,
      });
      expect(result).toBe('2026-03-31');
    });
  });

  describe('leap-year February', () => {
    it('monthly: Jan 31 + anchorDay 31 -> Feb 29 (2028 IS a leap year)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2028-01-31',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 31,
      });
      expect(result).toBe('2028-02-29');
    });

    it('monthly snap-back: Feb 29 + anchorDay 31 -> Mar 31 (leap year)', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2028-02-29',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 31,
      });
      expect(result).toBe('2028-03-31');
    });
  });

  describe('multi-month frequencies crossing a clamp boundary', () => {
    it('quarterly: Nov 30 + anchorDay 31 -> Feb 28 (2027 is not a leap year)', () => {
      // Nov 30 + 3 months = Feb; Feb has 28 days in 2027; anchorDay 31 clamps to 28.
      const result = calculateNextDueDate({
        currentDueDate: '2026-11-30',
        frequency: SUBSCRIPTION_FREQUENCIES.quarterly,
        anchorDay: 31,
      });
      expect(result).toBe('2027-02-28');
    });

    it('annual: Feb 29 (leap) + anchorDay 31 -> Feb 28 (2029 is not a leap year)', () => {
      // 2028-02-29 + 12 months = 2029-02; 2029 is not a leap year -> clamp to 28.
      const result = calculateNextDueDate({
        currentDueDate: '2028-02-29',
        frequency: SUBSCRIPTION_FREQUENCIES.annual,
        anchorDay: 31,
      });
      expect(result).toBe('2029-02-28');
    });
  });

  describe('year rollover', () => {
    it('monthly: Dec 15 -> Jan 15 of the following year', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-12-15',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        anchorDay: 15,
      });
      expect(result).toBe('2027-01-15');
    });
  });

  describe('custom frequency', () => {
    const custom = SUBSCRIPTION_FREQUENCIES.custom;

    it('every 30 days: adds exactly 30 days, across a month end', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-01-15',
        frequency: custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 30,
        anchorDay: 15,
      });
      expect(result).toBe('2026-02-14');
    });

    it('every 3 weeks: adds exactly 21 days', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-12-20',
        frequency: custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week,
        intervalCount: 3,
        anchorDay: 20,
      });
      expect(result).toBe('2027-01-10');
    });

    it('every 2 months: clamps to Feb 28 and snaps back to the anchor day', () => {
      const february = calculateNextDueDate({
        currentDueDate: '2025-12-31',
        frequency: custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.month,
        intervalCount: 2,
        anchorDay: 31,
      });
      const april = calculateNextDueDate({
        currentDueDate: february,
        frequency: custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.month,
        intervalCount: 2,
        anchorDay: 31,
      });
      expect([february, april]).toEqual(['2026-02-28', '2026-04-30']);
    });

    it('every 2 years: Feb 29 anchor lands on the next leap day', () => {
      const result = calculateNextDueDate({
        currentDueDate: '2026-02-28',
        frequency: custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.year,
        intervalCount: 2,
        anchorDay: 29,
      });
      expect(result).toBe('2028-02-29');
    });

    it('throws without a step', () => {
      expect(() => calculateNextDueDate({ currentDueDate: '2026-01-15', frequency: custom, anchorDay: 15 })).toThrow();
    });
  });
});
