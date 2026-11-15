import { getDateFnsLocale } from '@/composable/use-date-locale';
import { formatUIAmount, toLocalNumber } from '@/js/helpers';
import { format, isValid, parseISO } from 'date-fns';

const MAX_FRACTION_DIGITS = 2;

const formatPlainNumber = ({ value }: { value: number }) =>
  toLocalNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: MAX_FRACTION_DIGITS });

/**
 * Formats one value of a visual by its kind. Money goes through the app's currency formatter, so a
 * custom currency shows with its own decimals and symbol. A percent value is in percentage points:
 * 12.5 shows as "12.5%".
 */
export const formatVisualValue = ({
  value,
  kind,
  currencyCode,
}: {
  value: number;
  kind: 'money' | 'number' | 'percent';
  currencyCode?: string;
}): string => {
  if (kind === 'money' && currencyCode) return formatUIAmount(value, { currency: currencyCode });
  if (kind === 'percent') return `${formatPlainNumber({ value })}%`;

  return formatPlainNumber({ value });
};

const DATE_ONLY_LENGTH = 10;

const formatParsed = ({ value, pattern }: { value: string; pattern: string }): string => {
  const parsed = parseISO(value);
  if (!isValid(parsed)) return value;

  return format(parsed, pattern, { locale: getDateFnsLocale() });
};

/** An ISO date as a short, locale-aware date; a date-time also shows its time. Unparseable text is returned as is. */
export const formatVisualDate = ({ value }: { value: string }): string =>
  formatParsed({ value, pattern: value.length === DATE_ONLY_LENGTH ? 'PP' : 'PPp' });

/** A compact date for an axis label: month and year when the axis spans years, month and day otherwise. */
export const formatVisualAxisDate = ({ value, includeYear }: { value: string; includeYear: boolean }): string =>
  formatParsed({ value, pattern: includeYear ? 'MMM yyyy' : 'MMM d' });
