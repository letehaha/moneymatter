import type { GoalInsights } from '@bt/shared/types';
import { format, subDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params: Record<string, unknown> = {}, plural?: number) => ({ key, ...params, plural }),
  }),
}));
vi.mock('@/composable/use-date-locale', () => ({
  useDateLocale: () => ({ format: (date: Date, formatStr: string) => format(date, formatStr) }),
}));

import { useGoalStatusText } from './use-goal-status-text';

const buildInsights = (overrides: Partial<GoalInsights> = {}) =>
  ({
    status: 'on_track',
    etaMonths: null,
    daysLeft: null,
    monthsLeft: null,
    input: { today: '2026-10-20' },
    ...overrides,
  }) as GoalInsights;

describe('useGoalStatusText', () => {
  const { statusText, targetDateText } = useGoalStatusText();

  it('pluralizes the months a behind goal runs late', () => {
    const goal = {
      status: 'active' as const,
      achievedAt: null,
      reachedHoldDays: 30,
      insights: buildInsights({ status: 'behind', etaMonths: 30, monthsLeft: 10 }),
    };
    expect(statusText({ goal })).toEqual({ key: 'goals.status.behindBy', count: 20, date: '', plural: 20 });
  });

  it('shows a goal reached once it was achieved, even after dipping below target', () => {
    const goal = {
      status: 'active' as const,
      achievedAt: subDays(new Date(), 5).toISOString(),
      reachedHoldDays: 30,
      insights: buildInsights({ status: 'behind' }),
    };
    expect(statusText({ goal })).toMatchObject({ key: 'goals.status.reached' });
  });

  it('formats the projected month from a bare progress', () => {
    const progress = { status: 'no_date' as const, etaMonths: 10, monthsLeft: null };
    expect(statusText({ progress, today: '2026-10-20' })).toMatchObject({
      key: 'goals.status.around',
      date: 'Aug 2027',
    });
  });

  it('formats the target date or says there is none', () => {
    expect(targetDateText({ targetDate: '2027-06-30' })).toMatchObject({
      key: 'goals.list.row.byDate',
      date: 'Jun 2027',
    });
    expect(targetDateText({ targetDate: null })).toMatchObject({ key: 'goals.list.row.noDate' });
  });
});
