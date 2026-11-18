import { describe, expect, it } from '@jest/globals';

import { elapsedFraction, historyPercent, roundPercent, schedulePercent } from './line-pace';

describe('elapsedFraction', () => {
  it('counts today as elapsed', () => {
    expect(elapsedFraction({ start: '2026-11-01', end: '2026-12-01', today: '2026-11-01' })).toBe(1 / 30);
    expect(elapsedFraction({ start: '2026-11-01', end: '2026-12-01', today: '2026-11-30' })).toBe(1);
  });

  it('clamps outside the period', () => {
    expect(elapsedFraction({ start: '2026-11-01', end: '2026-12-01', today: '2026-10-15' })).toBe(0);
    expect(elapsedFraction({ start: '2026-11-01', end: '2026-12-01', today: '2026-12-20' })).toBe(1);
  });
});

describe('historyPercent', () => {
  it('takes the median share spent by the same relative day', () => {
    const periods = [
      { days: 30, spend: [{ offset: 0, amount: 100 }] },
      {
        days: 30,
        spend: [
          { offset: 5, amount: 50 },
          { offset: 20, amount: 50 },
        ],
      },
      { days: 30, spend: [{ offset: 29, amount: 100 }] },
    ];
    expect(historyPercent({ periods, fraction: 10 / 30 })).toBe(50);
    expect(historyPercent({ periods, fraction: 19 / 30 })).toBe(50);
  });

  it('counts offset 0 as the first day', () => {
    const periods = [
      { days: 31, spend: [{ offset: 0, amount: 10 }] },
      { days: 28, spend: [{ offset: 0, amount: 10 }] },
    ];
    expect(historyPercent({ periods, fraction: 1 / 30 })).toBe(100);
  });

  it('skips periods without net spend and needs two left', () => {
    const periods = [
      { days: 30, spend: [{ offset: 0, amount: 100 }] },
      { days: 30, spend: [{ offset: 1, amount: -100 }] },
      { days: 30, spend: [] },
    ];
    expect(historyPercent({ periods, fraction: 0.5 })).toBeNull();
  });

  it('clamps a share pushed past the total by a later refund', () => {
    const periods = [
      {
        days: 30,
        spend: [
          { offset: 0, amount: 100 },
          { offset: 20, amount: -50 },
        ],
      },
      { days: 30, spend: [{ offset: 0, amount: 100 }] },
    ];
    expect(historyPercent({ periods, fraction: 0.1 })).toBe(100);
  });
});

describe('schedulePercent', () => {
  it('adds the due payments to an even spread of the unscheduled rest', () => {
    const occurrences = [
      { date: '2026-11-01', amount: 300 },
      { date: '2026-11-20', amount: 200 },
    ];
    expect(schedulePercent({ occurrences, today: '2026-11-10', funded: 1000, fraction: 0.5 })).toBeCloseTo(55, 10);
  });

  it('caps at 100 when the schedule outruns the funding', () => {
    const occurrences = [{ date: '2026-11-01', amount: 2000 }];
    expect(schedulePercent({ occurrences, today: '2026-11-10', funded: 1000, fraction: 0.5 })).toBe(100);
  });

  it('is null with nothing scheduled', () => {
    expect(schedulePercent({ occurrences: [], today: '2026-11-10', funded: 1000, fraction: 0.5 })).toBeNull();
  });
});

describe('roundPercent', () => {
  it('rounds to two decimals', () => {
    expect(roundPercent({ value: 33.33333 })).toBe(33.33);
  });
});
