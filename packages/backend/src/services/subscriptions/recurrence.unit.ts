import { addRecurrenceStep, normalizeRecurrence, resolveRecurrenceStep } from '@bt/shared/subscriptions/recurrence';
import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

const { day, week, month, year } = SUBSCRIPTION_INTERVAL_UNITS;

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

describe('resolveRecurrenceStep', () => {
  it.each([
    [SUBSCRIPTION_FREQUENCIES.weekly, { unit: week, count: 1 }],
    [SUBSCRIPTION_FREQUENCIES.biweekly, { unit: week, count: 2 }],
    [SUBSCRIPTION_FREQUENCIES.monthly, { unit: month, count: 1 }],
    [SUBSCRIPTION_FREQUENCIES.quarterly, { unit: month, count: 3 }],
    [SUBSCRIPTION_FREQUENCIES.semiAnnual, { unit: month, count: 6 }],
    [SUBSCRIPTION_FREQUENCIES.annual, { unit: year, count: 1 }],
  ])('maps the %s preset to its fixed step', (frequency, step) => {
    expect(resolveRecurrenceStep({ frequency, intervalUnit: null, intervalCount: null })).toEqual(step);
  });

  it('ignores a stray step on a preset', () => {
    expect(
      resolveRecurrenceStep({ frequency: SUBSCRIPTION_FREQUENCIES.monthly, intervalUnit: day, intervalCount: 30 }),
    ).toEqual({ unit: month, count: 1 });
  });

  it('reads the step of a custom frequency', () => {
    expect(
      resolveRecurrenceStep({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: day, intervalCount: 30 }),
    ).toEqual({ unit: day, count: 30 });
  });

  it('throws for a custom frequency without a step', () => {
    expect(() =>
      resolveRecurrenceStep({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: null, intervalCount: null }),
    ).toThrow();
    expect(() =>
      resolveRecurrenceStep({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: day, intervalCount: null }),
    ).toThrow();
  });
});

describe('normalizeRecurrence', () => {
  it.each([
    [week, 1, SUBSCRIPTION_FREQUENCIES.weekly],
    [day, 7, SUBSCRIPTION_FREQUENCIES.weekly],
    [week, 2, SUBSCRIPTION_FREQUENCIES.biweekly],
    [day, 14, SUBSCRIPTION_FREQUENCIES.biweekly],
    [month, 1, SUBSCRIPTION_FREQUENCIES.monthly],
    [month, 3, SUBSCRIPTION_FREQUENCIES.quarterly],
    [month, 6, SUBSCRIPTION_FREQUENCIES.semiAnnual],
    [month, 12, SUBSCRIPTION_FREQUENCIES.annual],
    [year, 1, SUBSCRIPTION_FREQUENCIES.annual],
  ])('folds a custom %s×%i into the %s preset', (intervalUnit, intervalCount, frequency) => {
    expect(normalizeRecurrence({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit, intervalCount })).toEqual({
      frequency,
      intervalUnit: null,
      intervalCount: null,
    });
  });

  it.each([
    [day, 28],
    [day, 30],
    [month, 2],
    [week, 3],
    [year, 2],
  ])('keeps a custom %s×%i as typed', (intervalUnit, intervalCount) => {
    expect(normalizeRecurrence({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit, intervalCount })).toEqual({
      frequency: SUBSCRIPTION_FREQUENCIES.custom,
      intervalUnit,
      intervalCount,
    });
  });

  it('clears the step for a preset', () => {
    expect(
      normalizeRecurrence({ frequency: SUBSCRIPTION_FREQUENCIES.quarterly, intervalUnit: day, intervalCount: 30 }),
    ).toEqual({ frequency: SUBSCRIPTION_FREQUENCIES.quarterly, intervalUnit: null, intervalCount: null });
  });

  it('leaves a custom frequency without a step for the caller to refuse', () => {
    expect(
      normalizeRecurrence({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: null, intervalCount: null }),
    ).toEqual({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: null, intervalCount: null });
  });
});

describe('addRecurrenceStep', () => {
  it('adds N days for a day step', () => {
    expect(isoDay(addRecurrenceStep({ date: utc('2026-01-15'), step: { unit: day, count: 30 } }))).toBe('2026-02-14');
  });

  it('adds 7N days for a week step', () => {
    expect(isoDay(addRecurrenceStep({ date: utc('2026-12-20'), step: { unit: week, count: 3 } }))).toBe('2027-01-10');
  });

  it('adds N months for a month step, clamping to the end of a shorter month', () => {
    expect(isoDay(addRecurrenceStep({ date: utc('2026-06-15'), step: { unit: month, count: 2 } }))).toBe('2026-08-15');
    expect(isoDay(addRecurrenceStep({ date: utc('2025-12-31'), step: { unit: month, count: 2 } }))).toBe('2026-02-28');
  });

  it('keeps the anchor day across month steps: Jan 31 → Mar 31 → May 31 every two months', () => {
    const step = { unit: month, count: 2 };
    const march = addRecurrenceStep({ date: utc('2026-01-31'), step, anchorDay: 31 });
    const may = addRecurrenceStep({ date: march, step, anchorDay: 31 });
    expect([isoDay(march), isoDay(may)]).toEqual(['2026-03-31', '2026-05-31']);
  });

  it('clamps to Apr 30 and returns to the 31st on the next step', () => {
    const step = { unit: month, count: 3 };
    const april = addRecurrenceStep({ date: utc('2026-01-31'), step, anchorDay: 31 });
    const july = addRecurrenceStep({ date: april, step, anchorDay: 31 });
    expect([isoDay(april), isoDay(july)]).toEqual(['2026-04-30', '2026-07-31']);
  });

  it('adds N years for a year step, Feb 29 clamping in a common year and returning with the anchor', () => {
    const step = { unit: year, count: 2 };
    expect(isoDay(addRecurrenceStep({ date: utc('2024-02-29'), step }))).toBe('2026-02-28');
    const common = addRecurrenceStep({ date: utc('2024-02-29'), step: { unit: year, count: 1 }, anchorDay: 29 });
    expect(isoDay(common)).toBe('2025-02-28');
    expect(isoDay(addRecurrenceStep({ date: utc('2026-02-28'), step, anchorDay: 29 }))).toBe('2028-02-29');
  });

  it('keeps the time of day', () => {
    const result = addRecurrenceStep({ date: new Date('2026-03-10T14:30:00Z'), step: { unit: day, count: 30 } });
    expect(result.toISOString()).toBe('2026-04-09T14:30:00.000Z');
  });

  it('does not mutate the input date', () => {
    const date = utc('2026-01-31');
    addRecurrenceStep({ date, step: { unit: month, count: 1 } });
    expect(isoDay(date)).toBe('2026-01-31');
  });
});
