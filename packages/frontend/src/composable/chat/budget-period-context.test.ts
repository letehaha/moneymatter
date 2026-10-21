import { describe, expect, it } from 'vitest';

import { budgetPeriodToChatPeriod } from './budget-period-context';

describe('budgetPeriodToChatPeriod', () => {
  it('names the last day of the period instead of the exclusive end', () => {
    expect(budgetPeriodToChatPeriod({ startDate: '2026-03-01', endDate: '2026-04-01' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });

  it('crosses a year end', () => {
    expect(budgetPeriodToChatPeriod({ startDate: '2026-12-01', endDate: '2027-01-01' })).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('keeps a date-time start on its calendar day', () => {
    expect(budgetPeriodToChatPeriod({ startDate: '2026-03-01T00:00:00', endDate: '2026-03-08T00:00:00' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-07',
    });
  });
});
