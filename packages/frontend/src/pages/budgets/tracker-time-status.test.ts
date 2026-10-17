import { BUDGET_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  formatDateRange,
  getTrackerGroup,
  getTrackerStatusLabel,
  getTrackerTimeStatus,
  shouldSuggestArchive,
} from './tracker-time-status';

const now = new Date(2026, 9, 17, 12);

describe('getTrackerTimeStatus', () => {
  it('returns noDates without any date', () => {
    expect(getTrackerTimeStatus({ now })).toEqual({ kind: 'noDates' });
  });

  it('returns active with days left inside the range', () => {
    expect(
      getTrackerTimeStatus({ startDate: new Date(2026, 9, 10), endDate: new Date(2026, 9, 23, 23, 59), now }),
    ).toEqual({ kind: 'active', daysLeft: 6 });
  });

  it('returns upcoming before the start', () => {
    expect(getTrackerTimeStatus({ startDate: new Date(2026, 10, 27), now })).toEqual({
      kind: 'upcoming',
      daysUntil: 41,
    });
  });

  it('reads a date-only start as a local date', () => {
    expect(getTrackerTimeStatus({ startDate: '2026-10-18', now })).toEqual({ kind: 'upcoming', daysUntil: 1 });
  });

  it('returns ended with days since end', () => {
    expect(getTrackerTimeStatus({ startDate: new Date(2025, 1, 18), endDate: new Date(2026, 1, 17), now })).toEqual({
      kind: 'ended',
      daysSinceEnd: 242,
    });
  });

  it('treats an end-only range as active until it passes', () => {
    expect(getTrackerTimeStatus({ endDate: new Date(2026, 9, 18, 23, 59), now })).toEqual({
      kind: 'active',
      daysLeft: 1,
    });
  });

  it('treats a start-only range that already started as active without a countdown', () => {
    expect(getTrackerTimeStatus({ startDate: new Date(2026, 9, 1), now })).toEqual({ kind: 'active', daysLeft: null });
  });

  it('keeps a tracker ending today active on its last day', () => {
    expect(getTrackerTimeStatus({ startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 17), now })).toEqual({
      kind: 'active',
      daysLeft: 0,
    });
  });

  it('ends a tracker whose end date was yesterday', () => {
    expect(getTrackerTimeStatus({ endDate: new Date(2026, 9, 16, 23, 59), now })).toEqual({
      kind: 'ended',
      daysSinceEnd: 1,
    });
  });
});

describe('getTrackerGroup', () => {
  it('puts archived trackers in the archived group regardless of dates', () => {
    expect(
      getTrackerGroup({ budget: { status: BUDGET_STATUSES.archived, startDate: undefined, endDate: undefined }, now }),
    ).toBe('archived');
  });
});

describe('shouldSuggestArchive', () => {
  const ended = { status: BUDGET_STATUSES.active, startDate: new Date(2026, 0, 1), archivePromptDismissed: false };

  it('suggests archiving exactly 30 days after the end', () => {
    expect(shouldSuggestArchive({ budget: { ...ended, endDate: new Date(2026, 8, 17) }, now })).toBe(true);
  });

  it('stays quiet 29 days after the end', () => {
    expect(shouldSuggestArchive({ budget: { ...ended, endDate: new Date(2026, 8, 18) }, now })).toBe(false);
  });

  it('stays quiet when the user opted out', () => {
    expect(
      shouldSuggestArchive({
        budget: { ...ended, endDate: new Date(2026, 7, 1), archivePromptDismissed: true },
        now,
      }),
    ).toBe(false);
  });
});

describe('getTrackerStatusLabel', () => {
  it.each([
    [{ kind: 'active', daysLeft: 0 } as const, { key: 'budgets.list.status.lastDay' }],
    [{ kind: 'active', daysLeft: 1 } as const, { key: 'budgets.list.status.oneDayLeft' }],
    [{ kind: 'active', daysLeft: 6 } as const, { key: 'budgets.list.status.daysLeft', params: { count: 6 } }],
    [{ kind: 'upcoming', daysUntil: 0 } as const, { key: 'budgets.list.status.startsToday' }],
    [{ kind: 'upcoming', daysUntil: 1 } as const, { key: 'budgets.list.status.startsTomorrow' }],
    [{ kind: 'upcoming', daysUntil: 41 } as const, { key: 'budgets.list.status.startsInDays', params: { count: 41 } }],
    [{ kind: 'ended', daysSinceEnd: 3 } as const, { key: 'budgets.list.status.ended' }],
  ])('labels %o', (status, expected) => {
    expect(getTrackerStatusLabel({ status })).toEqual(expected);
  });

  it('has no label without dates or without an end date', () => {
    expect(getTrackerStatusLabel({ status: { kind: 'noDates' } })).toBeNull();
    expect(getTrackerStatusLabel({ status: { kind: 'active', daysLeft: null } })).toBeNull();
  });
});

describe('formatDateRange', () => {
  it('returns null without dates', () => {
    expect(formatDateRange({})).toBeNull();
  });

  it('drops the first year when both dates share it', () => {
    expect(formatDateRange({ from: new Date(2026, 8, 23), to: new Date(2026, 9, 7) })).toBe('Sep 23 → Oct 7, 2026');
  });

  it('keeps both years across a year boundary', () => {
    expect(formatDateRange({ from: new Date(2023, 6, 26), to: new Date(2026, 2, 16) })).toBe(
      'Jul 26, 2023 → Mar 16, 2026',
    );
  });

  it('reads date-only strings as local dates', () => {
    expect(formatDateRange({ from: '2026-03-02', to: '2026-03-02' })).toBe('Mar 2 → Mar 2, 2026');
  });

  it('formats open-ended ranges', () => {
    expect(formatDateRange({ from: new Date(2026, 8, 23) })).toBe('Sep 23, 2026 →');
    expect(formatDateRange({ to: new Date(2026, 9, 7) })).toBe('→ Oct 7, 2026');
  });
});
