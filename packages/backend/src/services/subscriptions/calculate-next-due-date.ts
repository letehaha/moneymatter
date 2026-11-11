import { addRecurrenceStep, resolveRecurrenceStep, type RecurrenceInput } from '@bt/shared/subscriptions/recurrence';

type CalculateNextDueDateParams = RecurrenceInput & {
  currentDueDate: string;
  anchorDay: number;
};

/**
 * Calculates the next due date from the schedule's recurrence step and anchor day.
 * Handles month-end clamping for month and year steps: if anchor is 31 but the month
 * only has 28 days, clamps to 28. When a month with 31 days comes back, returns to 31.
 */
export function calculateNextDueDate({
  currentDueDate,
  frequency,
  intervalUnit,
  intervalCount,
  anchorDay,
}: CalculateNextDueDateParams): string {
  const next = addRecurrenceStep({
    date: new Date(currentDueDate + 'T00:00:00Z'),
    step: resolveRecurrenceStep({ frequency, intervalUnit, intervalCount }),
    anchorDay,
  });
  return next.toISOString().split('T')[0]!;
}
