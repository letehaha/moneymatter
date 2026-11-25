import { formatTimeAxisLabel } from './format-time-axis-label';

const format = (_date: Date, pattern: string) => pattern;
const date = new Date(2026, 0, 15);

describe('formatTimeAxisLabel', () => {
  it.each([
    [401, 'MMM yy'],
    [400, 'MMM'],
    [61, 'MMM'],
    [60, 'MMM d'],
    [1, 'MMM d'],
  ])('a %d-day span uses %s', (spanDays, pattern) => {
    expect(formatTimeAxisLabel({ date, spanDays, format })).toBe(pattern);
  });
});
