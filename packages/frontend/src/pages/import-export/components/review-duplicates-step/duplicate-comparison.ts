import { formatShortDate } from '@/common/utils/date';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import type { DuplicateMatch } from '@bt/shared/types';

/** Shown in a comparison cell when that side has no value for the field. */
export const DUPLICATE_PLACEHOLDER = '–';

const formattersByDecimals = new Map<number, Intl.NumberFormat>();

/**
 * Rounds half away from zero on the decimal digits of the number as written (`1.005` -> `1.01`),
 * the way the duplicate key rounds. `Number.toFixed` rounds the binary value instead (`1.005` -> `1.00`).
 */
const getAmountFormatter = ({ decimals }: { decimals: number }): Intl.NumberFormat => {
  let formatter = formattersByDecimals.get(decimals);

  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      useGrouping: false,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      roundingMode: 'halfExpand',
      // A negative amount that rounds to zero shows as `0.00`, not `-0.00`
      signDisplay: 'negative',
    });
    formattersByDecimals.set(decimals, formatter);
  }

  return formatter;
};

/**
 * detect-duplicates returns decimal amounts; they show at the decimals of the row's currency,
 * rounded half-up like the duplicate key and the import write.
 */
export const formatDuplicateAmount = ({ amount, currencyCode }: { amount: number; currencyCode: string }): string =>
  getAmountFormatter({ decimals: getCurrencyDecimals({ code: currencyCode }) }).format(amount);

/**
 * Locale-aware date formatting for comparison cells. Delegates to formatShortDate,
 * which returns the raw input on invalid/empty values rather than throwing.
 */
export const formatDuplicateDate = (iso: string): string => formatShortDate(iso);

/** Fields compared between an imported CSV row and its matched existing transaction. */
export type ComparisonFieldKey = 'amount' | 'date' | 'note' | 'category';

/** One field compared across both sides; a `null` value means that side has nothing. */
interface ComparisonRow {
  /** Stable field key – the caller maps it to a localized label. */
  key: ComparisonFieldKey;
  csv: string | null;
  existing: string | null;
  /** Amount – render monospace + medium weight. */
  emphasis?: boolean;
}

/**
 * Field-by-field comparison of a duplicate pair. Amount and date always show;
 * note and category only when at least one side has a value (existing
 * transactions carry no category, so that row is CSV-only). Returned in display
 * order; rows blank on both sides are dropped.
 */
export const buildComparisonRows = (item: DuplicateMatch): ComparisonRow[] => {
  const csv = item.importedTransaction;
  const existing = item.existingTransaction;
  const rows: ComparisonRow[] = [
    {
      key: 'amount',
      csv: formatDuplicateAmount({ amount: csv.amount, currencyCode: csv.currencyCode }),
      existing: formatDuplicateAmount({ amount: existing.amount, currencyCode: csv.currencyCode }),
      emphasis: true,
    },
    { key: 'date', csv: formatDuplicateDate(csv.date), existing: formatDuplicateDate(existing.date) },
    { key: 'note', csv: csv.description || null, existing: existing.note || null },
    { key: 'category', csv: csv.categoryName || null, existing: null },
  ];
  return rows.filter((row) => row.csv !== null || row.existing !== null);
};

/** Per-side field list (one side of the comparison) – drops fields absent on that side. */
export const sideComparisonFields = (item: DuplicateMatch, side: 'csv' | 'existing'): ComparisonRow[] =>
  buildComparisonRows(item).filter((row) => row[side] !== null);
