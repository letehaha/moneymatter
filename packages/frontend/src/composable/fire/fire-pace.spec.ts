import { FIRE_HISTORY_BASELINE_MONTH } from '@bt/shared/types';
import { addMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';

import type { FirePlan, FirePlanStatus } from './build-fire-plan';
import { anchorFireSettings, comparePace, earliestPaceMonth, fireSettingsAt, resolvePaceAnchor } from './fire-pace';

const NOW = new Date(2026, 9, 28);
const ANCHOR = resolvePaceAnchor({ paceAnchor: null, now: NOW });

const makePlan = ({
  status = 'ready',
  start,
  etaMonths,
  balance = 100_000,
  spending = 36_000,
  contribution = 2_000,
  seedMonths = 12,
}: {
  status?: FirePlanStatus;
  start: Date;
  etaMonths: number | null;
  balance?: number;
  spending?: number | null;
  contribution?: number;
  seedMonths?: number;
}): FirePlan =>
  ({
    status,
    inputs: { balance, spending, contribution, seed: { monthsUsed: seedMonths } },
    eta: etaMonths === null ? null : { months: etaMonths, date: addMonths(start, etaMonths), ageAtDate: null },
    chart:
      etaMonths === null
        ? null
        : {
            history: [],
            projection: Array.from({ length: etaMonths + 25 }, (_, m) => ({
              date: addMonths(start, m),
              value: balance + m * 1_000,
            })),
            rangeHigh: null,
            rangeLow: null,
            targetLine: 900_000,
            milestoneMonths: [],
            fireMonth: etaMonths,
          },
  }) as unknown as FirePlan;

const compare = ({ current, anchorPlan }: { current: FirePlan; anchorPlan: FirePlan }) =>
  comparePace({ current, anchorPlan, anchor: ANCHOR, anchorInflationPct: 0, usesRecordedSettings: false, now: NOW });

describe('resolvePaceAnchor', () => {
  it('defaults to the end of the month a year ago', () => {
    expect(ANCHOR).toStrictEqual({ month: '2025-10', date: new Date(2025, 9, 31, 23, 59, 59, 999), isRolling: true });
  });

  it('uses a pinned past month', () => {
    expect(resolvePaceAnchor({ paceAnchor: '2025-01', now: NOW })).toMatchObject({
      month: '2025-01',
      isRolling: false,
    });
  });

  it('falls back to rolling for the current month, a future month or garbage', () => {
    for (const paceAnchor of ['2026-10', '2027-02', 'nope']) {
      expect(resolvePaceAnchor({ paceAnchor, now: NOW }).month).toBe('2025-10');
    }
  });
});

describe('fireSettingsAt', () => {
  const history = [
    { month: FIRE_HISTORY_BASELINE_MONTH, fire: { withdrawalRatePct: 4 } },
    { month: '2026-03', fire: { withdrawalRatePct: 3.5 } },
    { month: '2026-08', fire: { withdrawalRatePct: 3 } },
  ];

  it('picks the last snapshot at or before the month', () => {
    expect(fireSettingsAt({ history, month: '2026-05' })).toStrictEqual({ withdrawalRatePct: 3.5 });
    expect(fireSettingsAt({ history, month: '2026-08' })).toStrictEqual({ withdrawalRatePct: 3 });
  });

  it('uses the baseline before the first recorded change', () => {
    expect(fireSettingsAt({ history, month: '2025-10' })).toStrictEqual({ withdrawalRatePct: 4 });
  });

  it('returns null without history', () => {
    expect(fireSettingsAt({ history: undefined, month: '2025-10' })).toBeNull();
    expect(fireSettingsAt({ history: [], month: '2025-10' })).toBeNull();
  });

  it('returns null before the first snapshot when there is no baseline', () => {
    expect(fireSettingsAt({ history: history.slice(1), month: '2025-10' })).toBeNull();
  });
});

describe('anchorFireSettings', () => {
  const history = [{ month: '2026-03', fire: { withdrawalRatePct: 3.5, targetType: 'fat' as const } }];

  it('overlays the current view keys on the recorded settings', () => {
    const current = { withdrawalRatePct: 4, targetType: 'lean' as const, paceAnchor: '2026-04' };
    expect(anchorFireSettings({ history, current, month: '2026-05' })).toStrictEqual({
      withdrawalRatePct: 3.5,
      targetType: 'lean',
      paceAnchor: '2026-04',
    });
  });

  it('drops recorded view keys the current settings leave unset', () => {
    expect(anchorFireSettings({ history, current: {}, month: '2026-05' })).toStrictEqual({ withdrawalRatePct: 3.5 });
  });

  it('falls back to the current settings when nothing is recorded', () => {
    const current = { withdrawalRatePct: 4 };
    expect(anchorFireSettings({ history, current, month: '2026-01' })).toBe(current);
    expect(anchorFireSettings({ history: undefined, current: undefined, month: '2026-01' })).toBeUndefined();
  });
});

describe('earliestPaceMonth', () => {
  it('adds the seed minimum to the first data month', () => {
    expect(earliestPaceMonth({ firstDataDate: new Date(2024, 6, 15) })).toBe('2024-10');
    expect(earliestPaceMonth({ firstDataDate: null })).toBeNull();
  });
});

describe('comparePace', () => {
  const anchorPlan = makePlan({ start: ANCHOR.date, etaMonths: 185 });
  const anchorEta = addMonths(ANCHOR.date, 185);
  const currentWith = ({ shift }: { shift: number }) =>
    ({
      ...makePlan({ start: NOW, etaMonths: 170 }),
      eta: { months: 170, date: addMonths(anchorEta, shift), ageAtDate: null },
    }) as FirePlan;

  it('is ahead beyond 2% of the months left at the anchor', () => {
    expect(compare({ current: currentWith({ shift: -4 }), anchorPlan })).toMatchObject({
      verdict: 'ahead',
      shiftMonths: -4,
    });
  });

  it('stays on pace inside the band', () => {
    for (const shift of [-3, 0, 3]) {
      expect(compare({ current: currentWith({ shift }), anchorPlan })?.verdict).toBe('on-pace');
    }
  });

  it('is behind beyond the band', () => {
    expect(compare({ current: currentWith({ shift: 4 }), anchorPlan })?.verdict).toBe('behind');
  });

  it('keeps at least a one-month band close to FIRE', () => {
    const near = makePlan({ start: ANCHOR.date, etaMonths: 20 });
    const nearEta = addMonths(ANCHOR.date, 20);
    const current = (shift: number) =>
      ({ ...near, eta: { months: 8, date: addMonths(nearEta, shift), ageAtDate: null } }) as FirePlan;
    expect(compare({ current: current(1), anchorPlan: near })?.verdict).toBe('on-pace');
    expect(compare({ current: current(2), anchorPlan: near })?.verdict).toBe('behind');
  });

  it('reads the expected balance off the anchor projection in todays money', () => {
    const pace = comparePace({
      current: currentWith({ shift: 0 }),
      anchorPlan,
      anchor: ANCHOR,
      anchorInflationPct: 3,
      usesRecordedSettings: true,
      now: NOW,
    });
    expect(pace?.expectedBalance).toBeCloseTo((100_000 + 12 * 1_000) * Math.pow(1.03, 1), 6);
    expect(pace?.forecast).toHaveLength(186);
    expect(pace?.usesRecordedSettings).toBe(true);
  });

  it('has no expected balance once the anchor FIRE month is already behind today', () => {
    const early = makePlan({ start: ANCHOR.date, etaMonths: 5 });
    const pace = compare({ current: makePlan({ start: NOW, etaMonths: 1 }), anchorPlan: early });
    expect(pace).toMatchObject({ expectedBalance: null, verdict: 'behind', shiftMonths: 8 });
  });

  it('flags a FIRE date that came back within reach or went out of it', () => {
    const unreachable = makePlan({ status: 'unreachable', start: ANCHOR.date, etaMonths: null });
    expect(compare({ current: currentWith({ shift: 0 }), anchorPlan: unreachable })).toMatchObject({
      verdict: 'back-in-reach',
      forecast: [],
    });
    const nowUnreachable = makePlan({ status: 'unreachable', start: NOW, etaMonths: null });
    expect(compare({ current: nowUnreachable, anchorPlan })?.verdict).toBe('off-track');
    expect(compare({ current: nowUnreachable, anchorPlan: unreachable })).toBeNull();
  });

  it('reports missing history when the anchor has too little data', () => {
    const needsSpending = makePlan({ status: 'needs-spending', start: ANCHOR.date, etaMonths: null, spending: null });
    expect(compare({ current: currentWith({ shift: 0 }), anchorPlan: needsSpending })?.verdict).toBe('no-history');
    const beforeData = makePlan({ start: ANCHOR.date, etaMonths: 185, seedMonths: 2 });
    expect(compare({ current: currentWith({ shift: 0 }), anchorPlan: beforeData })).toMatchObject({
      verdict: 'no-history',
      forecast: [],
    });
  });

  it('hides while loading and once FIRE is reached', () => {
    const loading = makePlan({ status: 'loading', start: ANCHOR.date, etaMonths: null });
    expect(compare({ current: currentWith({ shift: 0 }), anchorPlan: loading })).toBeNull();
    const reached = makePlan({ status: 'reached', start: NOW, etaMonths: 0 });
    expect(compare({ current: reached, anchorPlan })).toBeNull();
  });
});
