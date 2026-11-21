import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/categories.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/subscription-periods.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/subscriptions.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/transactions.model', () => ({ __esModule: true, default: {} }));

import { scheduleDatesInRange } from './get-upcoming-payments';

const monthly = ({ dueDate, endDate = null }: { dueDate: string; endDate?: string | null }) => ({
  startDate: dueDate,
  dueDate,
  anchorDay: null,
  endDate,
  frequency: SUBSCRIPTION_FREQUENCIES.monthly,
  intervalUnit: null,
  intervalCount: null,
});

describe('scheduleDatesInRange', () => {
  it('includes a date equal to `from` and excludes one equal to `until`', () => {
    expect(
      scheduleDatesInRange({
        subscription: monthly({ dueDate: '2026-11-01' }),
        from: '2026-11-01',
        until: '2026-12-01',
      }),
    ).toEqual(['2026-11-01']);
  });

  it('steps from an old due date and keeps the occurrences already past', () => {
    expect(
      scheduleDatesInRange({
        subscription: monthly({ dueDate: '2026-01-10' }),
        from: '2026-09-01',
        until: '2026-12-01',
      }),
    ).toEqual(['2026-09-10', '2026-10-10', '2026-11-10']);
  });

  it('stops at the end date', () => {
    expect(
      scheduleDatesInRange({
        subscription: monthly({ dueDate: '2026-01-10', endDate: '2026-10-10' }),
        from: '2026-09-01',
        until: '2026-12-01',
      }),
    ).toEqual(['2026-09-10', '2026-10-10']);
  });
});
