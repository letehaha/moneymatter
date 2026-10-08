import { type SupportedLocale } from '../i18n/locales';
import type { DateFieldOrder } from '../types/import-export/core';

/**
 * Timezone-agnostic normalized result of parsing a single raw date cell.
 *
 * The engine never applies a timezone. A later piece anchors `dateOnly` /
 * `localDateTime` values to the user's browser timezone to decide the stored
 * instant; `instant` already carries an absolute moment and is preserved as-is.
 *
 * Lives in `shared` because the import wizard's client-side preview and the
 * server's actual parse MUST agree cell-for-cell — a second hand-mirrored
 * grammar is how they drift apart.
 */
export type ParsedImportDate =
  | { kind: 'instant'; instant: Date }
  | {
      kind: 'localDateTime';
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
      ms: number;
    }
  | { kind: 'dateOnly'; year: number; month: number; day: number };

interface ParseImportDateParams {
  value: string;
  format: DateColumnFormat;
}

/**
 * A single resolved format applied to a whole mapped date column.
 *
 * `fieldOrder` only governs the ambiguous slash/dot/dash family (`d/d/yyyy`);
 * ISO, ISO-datetime and compact values carry their order intrinsically and
 * ignore it.
 */
export interface DateColumnFormat {
  fieldOrder: DateFieldOrder;
}

interface DetectDateColumnFormatParams {
  values: string[];
  locale: SupportedLocale;
}

/**
 * Outcome of inferring a whole date column's likely format.
 *
 * `mixed` means the column contains contradicting signals (one row is only
 * valid day-first, another only valid month-first) — there is no single order
 * the detector can suggest.
 */
type DetectDateColumnFormatResult = { ok: true; format: DateColumnFormat } | { ok: false; reason: 'mixed' };

// ISO datetime carrying an explicit zone (`Z` or `±hh:mm`) — an absolute moment.
const ISO_ZONED_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ISO datetime WITHOUT a zone (T- or space-separated, optional seconds/ms). The
// wall-clock components are captured verbatim; no timezone is applied here.
const ISO_LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

// Year-first date with `-`, `/` or `.` separators (YYYY-MM-DD and variants).
const ISO_DATE = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;

// Compact 8-digit YYYYMMDD with no separators.
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

// Year-LAST date with two 1-2 digit lead fields and a 4- or 2-digit year
// (d/d/yyyy, d/d/yy, `/ . -` separators), optionally followed by a time —
// comma- or space-separated `hh:mm`, with optional seconds (e.g.
// "01/01/26, 10:58" as exported by some money apps). Which lead field is the
// day vs the month is intrinsically ambiguous, so it is resolved at the
// column level via `DateColumnFormat.fieldOrder`.
const AMBIGUOUS_DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:(?:,\s*|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

// First separator character of an ambiguous-family value, for option labels.
const AMBIGUOUS_SEPARATOR = /^\d{1,2}([/.-])/;

function isValidCalendarDate({ year, month, day }: { year: number; month: number; day: number }): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // `new Date(year, month, 0)` is the last day of `month`, so this rejects
  // overlong days (e.g. Feb 30) instead of letting them roll into next month.
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

// POSIX-style pivot: bank/app exports realistically span 1970–2069, so `26`
// reads as 2026 and `99` as 1999.
function resolveAmbiguousYear(yearStr: string): number {
  const year = Number(yearStr);
  if (yearStr.length === 4) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/** True when the value is an ISO date/datetime or compact YYYYMMDD — shapes
 *  that carry their field order intrinsically and ignore `fieldOrder`. */
export function isIntrinsicallyOrdered({ value }: { value: string }): boolean {
  return (
    ISO_ZONED_DATETIME.test(value) || ISO_LOCAL_DATETIME.test(value) || ISO_DATE.test(value) || COMPACT_DATE.test(value)
  );
}

export function parseImportDate({ value, format }: ParseImportDateParams): ParsedImportDate | null {
  if (ISO_ZONED_DATETIME.test(value)) {
    return { kind: 'instant', instant: new Date(value) };
  }

  const localMatch = value.match(ISO_LOCAL_DATETIME);
  if (localMatch) {
    const [, year, month, day, hour, minute, second, fraction] = localMatch;
    if (!isValidCalendarDate({ year: Number(year), month: Number(month), day: Number(day) })) return null;
    return {
      kind: 'localDateTime',
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: second ? Number(second) : 0,
      ms: fraction ? Number((Number(`0.${fraction}`) * 1000).toFixed(0)) : 0,
    };
  }

  const isoDateMatch = value.match(ISO_DATE);
  if (isoDateMatch) {
    const [, yearStr, monthStr, dayStr] = isoDateMatch;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (isValidCalendarDate({ year, month, day })) {
      return { kind: 'dateOnly', year, month, day };
    }
  }

  const compactMatch = value.match(COMPACT_DATE);
  if (compactMatch) {
    const [, yearStr, monthStr, dayStr] = compactMatch;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (isValidCalendarDate({ year, month, day })) {
      return { kind: 'dateOnly', year, month, day };
    }
  }

  const ambiguousMatch = value.match(AMBIGUOUS_DMY);
  if (ambiguousMatch) {
    const [, firstStr, secondStr, yearStr, hourStr, minuteStr, secondsStr] = ambiguousMatch;
    const first = Number(firstStr);
    const second = Number(secondStr);
    const year = resolveAmbiguousYear(yearStr!);
    // The whole column shares one order, so a leading field is the day or the
    // month consistently — never re-guessed per value.
    const day = format.fieldOrder === 'day-first' ? first : second;
    const month = format.fieldOrder === 'day-first' ? second : first;
    if (!isValidCalendarDate({ year, month, day })) return null;

    if (hourStr === undefined) {
      return { kind: 'dateOnly', year, month, day };
    }
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const seconds = secondsStr === undefined ? 0 : Number(secondsStr);
    // Same no-rollover rule as dates: an impossible time fails loudly instead
    // of snapping into the next hour/day.
    if (hour > 23 || minute > 59 || seconds > 59) return null;
    return { kind: 'localDateTime', year, month, day, hour, minute, second: seconds, ms: 0 };
  }

  return null;
}

/**
 * Day/month-order signals carried by a column's cells. Only the ambiguous
 * d/d/yyyy family is informative: a lead field above 12 can only be a day
 * (→ day-first); a second field above 12 can only be a month-position day
 * (→ month-first). All other shapes are intrinsically ordered and contribute
 * nothing.
 */
export function detectDateOrderSignals({ values }: { values: string[] }): {
  sawDayFirst: boolean;
  sawMonthFirst: boolean;
} {
  let sawDayFirst = false;
  let sawMonthFirst = false;

  for (const value of values) {
    const match = value.match(AMBIGUOUS_DMY);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12) sawDayFirst = true;
    if (second > 12) sawMonthFirst = true;
  }

  return { sawDayFirst, sawMonthFirst };
}

/**
 * Suggests a day/month order for a whole date column. This is a SUGGESTION
 * algorithm, not the authority: the CSV import path parses with the
 * `dateFieldOrder` the user explicitly confirmed in the wizard (the frontend
 * builds its pre-suggestion on the same signals via `detectDateOrderSignals`).
 */
export function detectDateColumnFormat({ values, locale }: DetectDateColumnFormatParams): DetectDateColumnFormatResult {
  const { sawDayFirst, sawMonthFirst } = detectDateOrderSignals({ values });

  if (sawDayFirst && sawMonthFirst) {
    return { ok: false, reason: 'mixed' };
  }
  if (sawDayFirst) {
    return { ok: true, format: { fieldOrder: 'day-first' } };
  }
  if (sawMonthFirst) {
    return { ok: true, format: { fieldOrder: 'month-first' } };
  }

  // No row disambiguates (every field ≤ 12). Suggest the locale's conventional
  // order: English writes month-first (MM/DD); every other shipped locale
  // writes day-first (DD/MM). Only a suggestion — the user still confirms.
  const fieldOrder = locale === 'en' ? 'month-first' : 'day-first';
  return { ok: true, format: { fieldOrder } };
}

/**
 * Separator of the first ambiguous-family cell (`.`, `/` or `-`), used to
 * render wizard option examples with the column's actual separator. `null`
 * when no ambiguous-family cell exists.
 */
export function detectAmbiguousDateSeparator({ values }: { values: string[] }): string | null {
  for (const value of values) {
    if (!AMBIGUOUS_DMY.test(value)) continue;
    const match = value.match(AMBIGUOUS_SEPARATOR);
    if (match?.[1]) return match[1];
  }
  return null;
}
