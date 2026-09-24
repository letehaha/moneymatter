import { describe, expect, it } from '@jest/globals';

import { addMonths, biweeklyDates, dueCycle, weeklyDates } from './goal-schedule';

describe('weeklyDates', () => {
  it('includes a weekday on the period start and excludes one on the period end', () => {
    expect(weeklyDates({ start: '2026-09-01', end: '2026-09-29', weekday: 2 })).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
    ]);
  });

  it('is empty for a period too short to hold the weekday', () => {
    expect(weeklyDates({ start: '2026-09-02', end: '2026-09-05', weekday: 2 })).toEqual([]);
  });
});

describe('biweeklyDates', () => {
  it('includes an anchor on the period start and excludes an occurrence on the period end', () => {
    expect(biweeklyDates({ start: '2026-09-01', end: '2026-09-29', anchorDate: '2026-09-01' })).toEqual([
      '2026-09-01',
      '2026-09-15',
    ]);
  });

  it('is empty for a period between two occurrences', () => {
    expect(biweeklyDates({ start: '2026-09-02', end: '2026-09-15', anchorDate: '2026-09-01' })).toEqual([]);
  });
});

describe('addMonths', () => {
  it('clamps to the month end without drifting', () => {
    expect(addMonths({ date: '2026-01-31', months: 1 })).toBe('2026-02-28');
    expect(addMonths({ date: '2026-01-31', months: 2 })).toBe('2026-03-31');
    expect(addMonths({ date: '2024-02-29', months: 12 })).toBe('2025-02-28');
  });
});

describe('dueCycle', () => {
  it('keeps a one-off due date even when past', () => {
    expect(dueCycle({ anchorDate: '2026-06-30', everyMonths: null, from: '2026-09-01' })).toEqual({
      dueDate: '2026-06-30',
      previousDueDate: null,
    });
  });

  it('returns the first due date on or after `from`', () => {
    expect(dueCycle({ anchorDate: '2026-09-15', everyMonths: 1, from: '2026-09-01' })).toEqual({
      dueDate: '2026-09-15',
      previousDueDate: null,
    });
    expect(dueCycle({ anchorDate: '2025-03-28', everyMonths: 12, from: '2027-03-28' })).toEqual({
      dueDate: '2027-03-28',
      previousDueDate: '2026-03-28',
    });
    expect(dueCycle({ anchorDate: '2026-01-31', everyMonths: 1, from: '2026-03-01' })).toEqual({
      dueDate: '2026-03-31',
      previousDueDate: '2026-02-28',
    });
  });
});
