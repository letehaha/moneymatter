import { describe, expect, it } from '@jest/globals';

import {
  type PeriodCadenceConfig,
  boundaryAtOrBefore,
  countPeriodsBetween,
  nextBoundary,
  validateSemiMonthlyDays,
} from './period-enumerator';

const days = ({ anchorDate, intervalN }: { anchorDate: string; intervalN: number }): PeriodCadenceConfig => ({
  cadence: 'days',
  intervalN,
  anchorDate,
  secondAnchorDay: null,
});

const months = ({ anchorDate, intervalN = 1 }: { anchorDate: string; intervalN?: number }): PeriodCadenceConfig => ({
  cadence: 'months',
  intervalN,
  anchorDate,
  secondAnchorDay: null,
});

const semiMonthly = ({
  anchorDate,
  secondAnchorDay,
}: {
  anchorDate: string;
  secondAnchorDay: number;
}): PeriodCadenceConfig => ({ cadence: 'semi_monthly', intervalN: 1, anchorDate, secondAnchorDay });

const sequence = ({ plan, from, count }: { plan: PeriodCadenceConfig; from: string; count: number }): string[] => {
  const result: string[] = [];
  let cursor = from;
  for (let i = 0; i < count; i += 1) {
    cursor = nextBoundary({ plan, after: cursor });
    result.push(cursor);
  }
  return result;
};

const propertyDates = [
  '2023-11-05',
  '2024-01-01',
  '2024-02-28',
  '2024-02-29',
  '2024-03-10',
  '2024-03-31',
  '2024-04-30',
  '2024-06-15',
  '2024-11-03',
  '2025-01-31',
  '2025-02-28',
  '2026-08-31',
];

/** Called from one `.unit.ts` per timezone: the enumerator must not depend on the host's. */
export const runPeriodEnumeratorCases = () => {
  describe('period-enumerator', () => {
    describe('days', () => {
      it('keeps 7-day periods across the spring DST change', () => {
        const plan = days({ anchorDate: '2024-03-07', intervalN: 7 });
        expect(sequence({ plan, from: '2024-03-07', count: 3 })).toEqual(['2024-03-14', '2024-03-21', '2024-03-28']);
      });

      it('keeps 7-day periods across the autumn DST change', () => {
        const plan = days({ anchorDate: '2024-10-31', intervalN: 7 });
        expect(sequence({ plan, from: '2024-10-31', count: 2 })).toEqual(['2024-11-07', '2024-11-14']);
      });

      it('keeps 14-day periods across the spring DST change', () => {
        const plan = days({ anchorDate: '2024-03-01', intervalN: 14 });
        expect(sequence({ plan, from: '2024-03-01', count: 2 })).toEqual(['2024-03-15', '2024-03-29']);
      });

      it('handles a custom interval and a year boundary', () => {
        const plan = days({ anchorDate: '2024-12-20', intervalN: 10 });
        expect(sequence({ plan, from: '2024-12-20', count: 3 })).toEqual(['2024-12-30', '2025-01-09', '2025-01-19']);
      });

      it('works for dates before the anchor', () => {
        const plan = days({ anchorDate: '2026-06-10', intervalN: 7 });
        expect(boundaryAtOrBefore({ plan, date: '2026-05-19' })).toBe('2026-05-13');
        expect(nextBoundary({ plan, after: '2026-05-19' })).toBe('2026-05-20');
        expect(boundaryAtOrBefore({ plan, date: '2026-05-20' })).toBe('2026-05-20');
      });
    });

    describe('months', () => {
      it('clamps day 31 and always recomputes from the anchor day', () => {
        const plan = months({ anchorDate: '2026-01-31' });
        expect(sequence({ plan, from: '2026-01-31', count: 5 })).toEqual([
          '2026-02-28',
          '2026-03-31',
          '2026-04-30',
          '2026-05-31',
          '2026-06-30',
        ]);
      });

      it('clamps day 31 to February 29 in a leap year', () => {
        const plan = months({ anchorDate: '2024-01-31' });
        expect(sequence({ plan, from: '2024-01-31', count: 2 })).toEqual(['2024-02-29', '2024-03-31']);
      });

      it('does not drift over 24+ periods', () => {
        const plan = months({ anchorDate: '2024-01-31' });
        const boundaries = sequence({ plan, from: '2024-01-31', count: 26 });
        expect(boundaries[11]).toBe('2025-01-31');
        expect(boundaries[23]).toBe('2026-01-31');
        expect(boundaries[25]).toBe('2026-03-31');
      });

      it('handles the 2024-02-29 anchor with N = 12', () => {
        const plan = months({ anchorDate: '2024-02-29', intervalN: 12 });
        expect(sequence({ plan, from: '2024-02-29', count: 4 })).toEqual([
          '2025-02-28',
          '2026-02-28',
          '2027-02-28',
          '2028-02-29',
        ]);
      });

      it('handles intervalN = 3', () => {
        const plan = months({ anchorDate: '2024-01-15', intervalN: 3 });
        expect(sequence({ plan, from: '2024-01-15', count: 4 })).toEqual([
          '2024-04-15',
          '2024-07-15',
          '2024-10-15',
          '2025-01-15',
        ]);
        expect(boundaryAtOrBefore({ plan, date: '2024-05-20' })).toBe('2024-04-15');
      });

      it('works for dates before the anchor', () => {
        const plan = months({ anchorDate: '2026-03-31' });
        expect(boundaryAtOrBefore({ plan, date: '2026-01-15' })).toBe('2025-12-31');
        expect(nextBoundary({ plan, after: '2026-01-15' })).toBe('2026-01-31');
        expect(boundaryAtOrBefore({ plan, date: '2025-11-30' })).toBe('2025-11-30');
      });
    });

    describe('semi_monthly', () => {
      it('handles 1 + 15', () => {
        const plan = semiMonthly({ anchorDate: '2026-01-01', secondAnchorDay: 15 });
        expect(sequence({ plan, from: '2026-01-01', count: 4 })).toEqual([
          '2026-01-15',
          '2026-02-01',
          '2026-02-15',
          '2026-03-01',
        ]);
      });

      it('handles 15 + 31 with clamping', () => {
        const plan = semiMonthly({ anchorDate: '2026-01-15', secondAnchorDay: 31 });
        expect(sequence({ plan, from: '2026-01-15', count: 5 })).toEqual([
          '2026-01-31',
          '2026-02-15',
          '2026-02-28',
          '2026-03-15',
          '2026-03-31',
        ]);
      });

      it('handles 20 + 31 with clamping, anchored on the later day', () => {
        const plan = semiMonthly({ anchorDate: '2026-01-31', secondAnchorDay: 20 });
        expect(sequence({ plan, from: '2026-01-31', count: 4 })).toEqual([
          '2026-02-20',
          '2026-02-28',
          '2026-03-20',
          '2026-03-31',
        ]);
      });

      it('works for dates before the anchor', () => {
        const plan = semiMonthly({ anchorDate: '2026-06-01', secondAnchorDay: 15 });
        expect(boundaryAtOrBefore({ plan, date: '2026-01-20' })).toBe('2026-01-15');
        expect(boundaryAtOrBefore({ plan, date: '2026-01-10' })).toBe('2026-01-01');
        expect(nextBoundary({ plan, after: '2025-12-31' })).toBe('2026-01-01');
      });
    });

    describe('a date exactly on a boundary', () => {
      it.each([
        days({ anchorDate: '2024-03-07', intervalN: 7 }),
        months({ anchorDate: '2026-01-31' }),
        semiMonthly({ anchorDate: '2026-01-15', secondAnchorDay: 31 }),
      ])('is returned by boundaryAtOrBefore and excluded by nextBoundary (%#)', (plan) => {
        const boundary = nextBoundary({ plan, after: '2026-06-05' });
        expect(boundaryAtOrBefore({ plan, date: boundary })).toBe(boundary);
        expect(nextBoundary({ plan, after: boundary }) > boundary).toBe(true);
      });
    });

    describe('countPeriodsBetween', () => {
      it('counts days periods', () => {
        const plan = days({ anchorDate: '2024-01-01', intervalN: 7 });
        expect(countPeriodsBetween({ plan, from: '2024-01-01', to: '2024-03-11' })).toBe(10);
      });

      it('counts months periods', () => {
        const plan = months({ anchorDate: '2026-01-31' });
        expect(countPeriodsBetween({ plan, from: '2026-01-31', to: '2027-01-31' })).toBe(12);
      });

      it('counts semi-monthly periods', () => {
        const plan = semiMonthly({ anchorDate: '2026-01-01', secondAnchorDay: 15 });
        expect(countPeriodsBetween({ plan, from: '2026-01-01', to: '2027-01-01' })).toBe(24);
      });

      it('is zero inside one period', () => {
        const plan = months({ anchorDate: '2026-01-10' });
        expect(countPeriodsBetween({ plan, from: '2026-01-15', to: '2026-02-09' })).toBe(0);
      });
    });

    describe('invariants', () => {
      it.each([
        days({ anchorDate: '2024-03-07', intervalN: 7 }),
        days({ anchorDate: '2026-06-10', intervalN: 14 }),
        days({ anchorDate: '2024-12-20', intervalN: 10 }),
        months({ anchorDate: '2026-01-31' }),
        months({ anchorDate: '2024-02-29', intervalN: 12 }),
        months({ anchorDate: '2024-01-15', intervalN: 3 }),
        semiMonthly({ anchorDate: '2026-01-01', secondAnchorDay: 15 }),
        semiMonthly({ anchorDate: '2026-01-15', secondAnchorDay: 31 }),
        semiMonthly({ anchorDate: '2026-01-31', secondAnchorDay: 20 }),
      ])('bracket every date and agree with each other (%#)', (plan) => {
        for (const date of propertyDates) {
          const start = boundaryAtOrBefore({ plan, date });
          const end = nextBoundary({ plan, after: date });
          expect(start <= date).toBe(true);
          expect(date < end).toBe(true);
          expect(nextBoundary({ plan, after: start })).toBe(end);
          expect(nextBoundary({ plan, after: date, steps: 3 })).toBe(sequence({ plan, from: date, count: 3 }).at(-1));
          expect(boundaryAtOrBefore({ plan, date: start })).toBe(start);
        }
      });
    });

    describe('validateSemiMonthlyDays', () => {
      it.each([
        [1, 15],
        [1, 16],
        [5, 20],
        [15, 31],
        [20, 31],
        [1, 11],
        [10, 28],
        [21, 31],
      ])('accepts %i + %i', (anchorDay, secondAnchorDay) => {
        expect(validateSemiMonthlyDays({ anchorDay, secondAnchorDay })).toBe(true);
        expect(validateSemiMonthlyDays({ anchorDay: secondAnchorDay, secondAnchorDay: anchorDay })).toBe(true);
      });

      it.each([
        [1, 31],
        [1, 10],
        [9, 28],
        [5, 5],
        [22, 31],
      ])('rejects %i + %i', (anchorDay, secondAnchorDay) => {
        expect(validateSemiMonthlyDays({ anchorDay, secondAnchorDay })).toBe(false);
      });
    });
  });
};
