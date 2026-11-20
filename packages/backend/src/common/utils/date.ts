/**
 * Extracts the UTC calendar day of a date as a `YYYY-MM-DD` string.
 *
 * Safe for both `Date` objects and date-ish strings (legacy `YYYY-MM-DD`
 * DATEONLY values and Postgres timestamptz text like `2026-06-20 12:00:00+00`).
 * Used so day-bucketing and day-level comparisons stay anchored to the UTC
 * calendar day regardless of the server's timezone — otherwise the same instant
 * could bucket into different days across deploys with different host TZs.
 *
 * String inputs are sliced (the first 10 chars are the `YYYY-MM-DD` prefix of
 * both shapes); `Date` inputs are read via the `getUTC*` accessors and
 * zero-padded.
 */
export const toUtcDateString = (date: Date | string): string => {
  if (typeof date === 'string') return date.length >= 10 ? date.slice(0, 10) : date;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
};

/** The calendar day `date` falls on in the IANA `timezone`, as `YYYY-MM-DD`. */
export const toZonedDateString = ({ date, timezone }: { date: Date; timezone: string }): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
