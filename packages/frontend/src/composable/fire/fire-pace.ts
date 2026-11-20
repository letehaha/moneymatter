import { FIRE_VIEW_KEYS, type FireSettings, type FireSettingsSnapshot } from '@bt/shared/types';
import {
  addMonths,
  differenceInCalendarMonths,
  endOfMonth,
  format,
  isValid,
  parse,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { omit, pick } from 'lodash-es';

import type { FireChartPoint, FirePlan } from './build-fire-plan';
import { FIRE_SEED_MIN_MONTHS } from './derive-fire-seed';

const PACE_ROLLING_MONTHS = 12;
const PACE_TOLERANCE_SHARE = 0.02;
const PACE_MIN_TOLERANCE_MONTHS = 1;
const MONTH_FORMAT = 'yyyy-MM';

export type FirePaceAnchor = { month: string; date: Date; isRolling: boolean };

export type FirePaceVerdict = 'ahead' | 'on-pace' | 'behind' | 'back-in-reach' | 'off-track' | 'no-history';

export type FirePace = {
  verdict: FirePaceVerdict;
  anchor: FirePaceAnchor;
  /** Today's FIRE date minus the anchor's, in months; negative is sooner. */
  shiftMonths: number | null;
  toleranceMonths: number | null;
  anchorEta: Date | null;
  currentEta: Date | null;
  /** What the anchor's projection expected by today, in today's money. */
  expectedBalance: number | null;
  balance: number;
  spending: { then: number | null; now: number | null };
  contribution: { then: number; now: number };
  /** Anchor projection up to its FIRE month, in today's money. */
  forecast: FireChartPoint[];
  usesRecordedSettings: boolean;
};

export const monthKey = ({ date }: { date: Date }) => format(date, MONTH_FORMAT);

export const parseMonthKey = ({ month }: { month: string }): Date | null => {
  const date = parse(`${month}-01`, 'yyyy-MM-dd', new Date());
  return isValid(date) ? date : null;
};

/** A pinned month must be before the current one; anything else falls back to the rolling month a year ago. */
export const resolvePaceAnchor = ({
  paceAnchor,
  now,
}: {
  paceAnchor: string | null | undefined;
  now: Date;
}): FirePaceAnchor => {
  const pinned = paceAnchor ? parseMonthKey({ month: paceAnchor }) : null;
  const isPinned = pinned !== null && pinned < startOfMonth(now);
  const month = isPinned ? pinned : subMonths(startOfMonth(now), PACE_ROLLING_MONTHS);
  return { month: monthKey({ date: month }), date: endOfMonth(month), isRolling: !isPinned };
};

/** History is appended in month order, so the last entry at or before `month` is the one in effect. */
export const fireSettingsAt = ({
  history,
  month,
}: {
  history: FireSettingsSnapshot[] | undefined;
  month: string;
}): FireSettings | null => history?.findLast((snapshot) => snapshot.month <= month)?.fire ?? null;

export const anchorFireSettings = ({
  history,
  current,
  month,
}: {
  history: FireSettingsSnapshot[] | undefined;
  current: FireSettings | undefined;
  month: string;
}): FireSettings | undefined => {
  const recorded = fireSettingsAt({ history, month });
  return recorded ? { ...omit(recorded, FIRE_VIEW_KEYS), ...pick(current, FIRE_VIEW_KEYS) } : current;
};

/** The anchor's seed needs FIRE_SEED_MIN_MONTHS of activity before it, counted from the first month with data. */
export const earliestPaceMonth = ({ firstDataDate }: { firstDataDate: Date | null }): string | null =>
  firstDataDate === null ? null : monthKey({ date: addMonths(startOfMonth(firstDataDate), FIRE_SEED_MIN_MONTHS) });

export const comparePace = ({
  current,
  anchorPlan,
  anchor,
  anchorInflationPct,
  usesRecordedSettings,
  now,
}: {
  current: FirePlan;
  anchorPlan: FirePlan;
  anchor: FirePaceAnchor;
  anchorInflationPct: number;
  usesRecordedSettings: boolean;
  now: Date;
}): FirePace | null => {
  if (current.status !== 'ready' && current.status !== 'unreachable') return null;
  if (anchorPlan.status === 'loading') return null;

  const elapsed = differenceInCalendarMonths(now, anchor.date);
  const toTodaysMoney = Math.pow(1 + anchorInflationPct / 100, elapsed / 12);
  const anchorFireMonth = anchorPlan.chart?.fireMonth ?? null;
  const forecast =
    anchorFireMonth === null
      ? []
      : (anchorPlan.chart?.projection ?? [])
          .slice(0, anchorFireMonth + 1)
          .map(({ date, value }) => ({ date, value: value * toTodaysMoney }));

  const anchorEta = anchorPlan.eta?.date ?? null;
  const currentEta = current.eta?.date ?? null;
  const base = {
    anchor,
    shiftMonths: null,
    toleranceMonths: null,
    anchorEta,
    currentEta,
    expectedBalance: forecast[elapsed]?.value ?? null,
    balance: current.inputs.balance,
    spending: { then: anchorPlan.inputs.spending, now: current.inputs.spending },
    contribution: { then: anchorPlan.inputs.contribution, now: current.inputs.contribution },
    forecast,
    usesRecordedSettings,
  };

  // A spending override builds a plan from an empty balance before the user's first data, which would read as progress.
  if (
    anchorPlan.status === 'no-data' ||
    anchorPlan.status === 'needs-spending' ||
    anchorPlan.inputs.seed.monthsUsed < FIRE_SEED_MIN_MONTHS
  )
    return { ...base, verdict: 'no-history', forecast: [] };
  if (currentEta === null) return anchorEta === null ? null : { ...base, verdict: 'off-track' };
  if (anchorEta === null) return { ...base, verdict: 'back-in-reach' };

  const shiftMonths = differenceInCalendarMonths(currentEta, anchorEta);
  const toleranceMonths = Math.max(PACE_MIN_TOLERANCE_MONTHS, PACE_TOLERANCE_SHARE * (anchorPlan.eta?.months ?? 0));
  const verdict = shiftMonths < -toleranceMonths ? 'ahead' : shiftMonths > toleranceMonths ? 'behind' : 'on-pace';
  return { ...base, verdict, shiftMonths, toleranceMonths };
};
