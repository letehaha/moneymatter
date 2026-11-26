/**
 * @jest-environment <rootDir>/src/services/budget-plans/periods/new-york-timezone-environment.ts
 */
import { describe, expect, it } from '@jest/globals';

import { fillPerAccountBalanceSeries, toBalanceDateKey } from './get-balance-history';

describe('balance series under America/New_York', () => {
  it('keys a yyyy-MM-dd day as that same day', () => {
    expect(toBalanceDateKey('2026-11-26')).toBe('2026-11-26');
    expect(toBalanceDateKey(new Date('2026-11-26'))).toBe('2026-11-26');
  });

  it('fills every day of a range that crosses the DST change, including the last one', () => {
    const series = fillPerAccountBalanceSeries({
      data: [{ accountId: 'a', date: '2026-10-15', amount: 100 }],
      from: '2026-10-15',
      to: '2026-11-26',
    });

    const days = Object.keys(series.a!);
    expect(days[0]).toBe('2026-10-15');
    expect(days.at(-1)).toBe('2026-11-26');
    expect(days).toHaveLength(43);
    expect(series.a!['2026-11-26']).toBe(100);
  });
});
