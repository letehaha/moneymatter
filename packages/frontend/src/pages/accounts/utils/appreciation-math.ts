import { addMonths, differenceInCalendarDays } from 'date-fns';

const DAYS_PER_YEAR = 365.25;

export interface AppreciationPoint {
  date: Date;
  value: number;
}

/**
 * Pure appreciation math — mirrors the backend's `computePropertyValue`:
 * `value = anchor * (1 + rate) ^ elapsedYears` with a fractional year count,
 * floored at zero.
 *
 * Keeping the frontend math identical to the backend's prevents the chart from
 * silently diverging from the headline current-value figure.
 */
export function samplePropertyValueAt({
  anchorValue,
  anchorDate,
  asOf,
  annualRatePct,
}: {
  anchorValue: number;
  anchorDate: Date;
  asOf: Date;
  annualRatePct: number;
}): number {
  const daysElapsed = differenceInCalendarDays(asOf, anchorDate);
  if (daysElapsed <= 0) return anchorValue;

  const value = anchorValue * Math.pow(1 + annualRatePct / 100, daysElapsed / DAYS_PER_YEAR);
  return value < 0 ? 0 : value;
}

function buildSegment({
  anchorValue,
  anchorDate,
  endDate,
  annualRatePct,
}: {
  anchorValue: number;
  anchorDate: Date;
  endDate: Date;
  annualRatePct: number;
}): AppreciationPoint[] {
  const points: AppreciationPoint[] = [{ date: new Date(anchorDate), value: anchorValue }];

  let month = 1;
  while (true) {
    const date = addMonths(anchorDate, month);
    if (date > endDate) break;

    points.push({ date, value: samplePropertyValueAt({ anchorValue, anchorDate, asOf: date, annualRatePct }) });
    month += 1;
  }

  return points;
}

/**
 * Build the value-over-time timeline. When `revaluation` is provided AND its
 * date is strictly after purchase, the curve has two segments meeting in a
 * vertical "kink" at the revaluation date:
 *
 *   purchase ──curve──► (curve-value @ revaluation.date)
 *                      │
 *                      │ ◄── instantaneous re-anchor jump
 *                      ▼
 *                 (revaluation.value) ──curve──► projection
 *
 * If revaluation is missing/null/at purchase, behaves as a single segment from
 * purchase forward.
 */
export function buildAppreciationTimeline({
  purchase,
  revaluation,
  monthsHorizon,
  annualRatePct,
}: {
  purchase: { value: number; date: Date };
  /** Latest revaluation (if any). Splits the curve into two segments meeting at this date/value. */
  revaluation?: { value: number; date: Date } | null;
  /** How far past the latest anchor (revaluation or purchase) to project. */
  monthsHorizon: number;
  annualRatePct: number;
}): AppreciationPoint[] {
  const hasRevaluation = revaluation != null && revaluation.date.getTime() > purchase.date.getTime();

  if (!hasRevaluation) {
    return buildSegment({
      anchorValue: purchase.value,
      anchorDate: purchase.date,
      endDate: addMonths(purchase.date, monthsHorizon),
      annualRatePct,
    });
  }

  const preRevaluation = buildSegment({
    anchorValue: purchase.value,
    anchorDate: purchase.date,
    endDate: revaluation.date,
    annualRatePct,
  });

  // Vertical kink: hold the pre-revaluation curve value at the revaluation date
  // so the line has a visible step, then jump to the revalued amount on the same
  // date. The two same-date points draw a vertical line in the chart.
  const lastPre = preRevaluation[preRevaluation.length - 1]!;
  const kinkPoints: AppreciationPoint[] =
    lastPre.date.getTime() === revaluation.date.getTime()
      ? [{ date: new Date(revaluation.date), value: revaluation.value }]
      : [
          { date: new Date(revaluation.date), value: lastPre.value },
          { date: new Date(revaluation.date), value: revaluation.value },
        ];

  const postRevaluation = buildSegment({
    anchorValue: revaluation.value,
    anchorDate: revaluation.date,
    endDate: addMonths(revaluation.date, monthsHorizon),
    annualRatePct,
  });

  // Drop postRevaluation's leading anchor point — kinkPoints already cover that date.
  return [...preRevaluation, ...kinkPoints, ...postRevaluation.slice(1)];
}
