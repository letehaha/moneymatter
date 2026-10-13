import { utilizationClasses } from '@/pages/budgets/budget-list-cards/shared/utilization-classes';
import { describe, expect, it } from 'vitest';

import { sortTrackerRows } from './tracker-rows';

describe('sortTrackerRows', () => {
  it('puts the most used limit first and trackers without a limit last, in their original order', () => {
    const rows = [
      { id: 'no-limit-a', utilizationRate: null, ended: false },
      { id: 'low', utilizationRate: 24, ended: false },
      { id: 'over', utilizationRate: 108, ended: false },
      { id: 'no-limit-b', utilizationRate: null, ended: false },
      { id: 'unused', utilizationRate: 0, ended: false },
    ];

    expect(sortTrackerRows({ rows }).map((row) => row.id)).toEqual([
      'over',
      'low',
      'unused',
      'no-limit-a',
      'no-limit-b',
    ]);
    expect(rows[0]!.id).toBe('no-limit-a');
  });

  it('keeps ended trackers and lists them after the running ones', () => {
    const rows = [
      { id: 'ended-over', utilizationRate: 120, ended: true },
      { id: 'running-no-limit', utilizationRate: null, ended: false },
      { id: 'ended-low', utilizationRate: 10, ended: true },
      { id: 'running', utilizationRate: 50, ended: false },
    ];

    expect(sortTrackerRows({ rows }).map((row) => row.id)).toEqual([
      'running',
      'running-no-limit',
      'ended-over',
      'ended-low',
    ]);
  });
});

describe('utilizationClasses', () => {
  it('switches to warning above 70 and to expense above 90', () => {
    expect(utilizationClasses({ rate: 70 }).bg).toBe('bg-success-text');
    expect(utilizationClasses({ rate: 71 }).bg).toBe('bg-warning-text');
    expect(utilizationClasses({ rate: 90 }).text).toBe('text-warning-text');
    expect(utilizationClasses({ rate: 91 }).text).toBe('text-app-expense-color');
  });
});
