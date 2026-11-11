import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_UNITS,
  type SubscriptionRecurrence,
} from '../types/subscriptions';

/**
 * The one place that turns a subscription's schedule into a step. Backend consumers
 * (next due date, next expected date, upcoming payments) advance dates through
 * `addRecurrenceStep`, so a preset and its custom twin give identical dates.
 * Dependency-free because both the backend and the frontend import it.
 */

export interface RecurrenceStep {
  unit: SUBSCRIPTION_INTERVAL_UNITS;
  count: number;
}

export type PresetFrequency = Exclude<SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_FREQUENCIES.custom>;

const PRESET_STEPS: Record<PresetFrequency, RecurrenceStep> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: { unit: SUBSCRIPTION_INTERVAL_UNITS.week, count: 1 },
  [SUBSCRIPTION_FREQUENCIES.biweekly]: { unit: SUBSCRIPTION_INTERVAL_UNITS.week, count: 2 },
  [SUBSCRIPTION_FREQUENCIES.monthly]: { unit: SUBSCRIPTION_INTERVAL_UNITS.month, count: 1 },
  [SUBSCRIPTION_FREQUENCIES.quarterly]: { unit: SUBSCRIPTION_INTERVAL_UNITS.month, count: 3 },
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: { unit: SUBSCRIPTION_INTERVAL_UNITS.month, count: 6 },
  [SUBSCRIPTION_FREQUENCIES.annual]: { unit: SUBSCRIPTION_INTERVAL_UNITS.year, count: 1 },
};

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

/** A schedule's recurrence fields; the step pair may be omitted for a preset. */
export type RecurrenceInput = Pick<SubscriptionRecurrence, 'frequency'> &
  Partial<Pick<SubscriptionRecurrence, 'intervalUnit' | 'intervalCount'>>;

/** The step a schedule repeats by. Throws for `custom` without a complete step. */
export const resolveRecurrenceStep = ({ frequency, intervalUnit, intervalCount }: RecurrenceInput): RecurrenceStep => {
  if (frequency !== SUBSCRIPTION_FREQUENCIES.custom) {
    const step = PRESET_STEPS[frequency];
    if (!step) throw new Error(`Unknown subscription frequency: ${frequency}`);
    return step;
  }
  if (!intervalUnit || !intervalCount) {
    throw new Error('A custom subscription frequency needs intervalUnit and intervalCount');
  }
  return { unit: intervalUnit, count: intervalCount };
};

/**
 * Comparable size of a step: days for day/week steps, months for month/year steps.
 * Only steps of the same family compare, which is what preset folding needs.
 */
const stepKey = ({ unit, count }: RecurrenceStep): string =>
  unit === SUBSCRIPTION_INTERVAL_UNITS.day || unit === SUBSCRIPTION_INTERVAL_UNITS.week
    ? `days:${unit === SUBSCRIPTION_INTERVAL_UNITS.week ? count * DAYS_PER_WEEK : count}`
    : `months:${unit === SUBSCRIPTION_INTERVAL_UNITS.year ? count * MONTHS_PER_YEAR : count}`;

const PRESET_BY_STEP_KEY = new Map(
  (Object.entries(PRESET_STEPS) as [PresetFrequency, RecurrenceStep][]).map(([frequency, step]) => [
    stepKey(step),
    frequency,
  ]),
);

/**
 * The triple to store: a custom step equal to a preset becomes that preset (week×1 and
 * day×7 → weekly, month×12 → annual), and a preset never carries a step. A custom
 * frequency without a complete step is returned unchanged for validation to refuse.
 */
export const normalizeRecurrence = ({
  frequency,
  intervalUnit,
  intervalCount,
}: RecurrenceInput): SubscriptionRecurrence => {
  if (frequency !== SUBSCRIPTION_FREQUENCIES.custom) {
    return { frequency, intervalUnit: null, intervalCount: null };
  }
  if (!intervalUnit || !intervalCount) {
    return { frequency, intervalUnit: intervalUnit ?? null, intervalCount: intervalCount ?? null };
  }
  const preset = PRESET_BY_STEP_KEY.get(stepKey({ unit: intervalUnit, count: intervalCount }));
  if (preset) return { frequency: preset, intervalUnit: null, intervalCount: null };
  return { frequency, intervalUnit, intervalCount };
};

const MS_PER_DAY = 86_400_000;

const daysInUtcMonth = ({ year, month }: { year: number; month: number }): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * `date` advanced by one step, in UTC, keeping the time of day. Day and week steps add
 * days. Month and year steps add months; the day of month is `anchorDay` when given (so a
 * schedule clamped to Apr 30 returns to the 31st), else the date's own day, either way
 * clamped to the target month's length.
 */
export const addRecurrenceStep = ({
  date,
  step,
  anchorDay,
}: {
  date: Date;
  step: RecurrenceStep;
  anchorDay?: number | null;
}): Date => {
  if (step.unit === SUBSCRIPTION_INTERVAL_UNITS.day || step.unit === SUBSCRIPTION_INTERVAL_UNITS.week) {
    const days = step.unit === SUBSCRIPTION_INTERVAL_UNITS.week ? step.count * DAYS_PER_WEEK : step.count;
    return new Date(date.getTime() + days * MS_PER_DAY);
  }

  const months = step.unit === SUBSCRIPTION_INTERVAL_UNITS.year ? step.count * MONTHS_PER_YEAR : step.count;
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  const day = Math.min(anchorDay ?? date.getUTCDate(), daysInUtcMonth({ year, month }));

  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
};
