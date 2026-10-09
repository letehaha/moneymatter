/**
 * Composable for locale-aware date-fns functions.
 *
 * main.ts sets the app locale as the date-fns default, which localizes plain
 * date-fns calls but is read only at call time. These wrappers read the locale
 * reactively, so a computed using them recomputes when the language changes.
 *
 * @see https://github.com/date-fns/date-fns/blob/main/docs/i18n.md
 */
import { getCurrentLocale } from '@/i18n';
import { type SupportedLocale, getValidLocale } from '@bt/shared/i18n/locales';
import {
  format as dateFnsFormat,
  formatDistance as dateFnsFormatDistance,
  formatDistanceToNow as dateFnsFormatDistanceToNow,
  formatRelative as dateFnsFormatRelative,
} from 'date-fns';
import { de, enUS, es, id, ru, sk, uk } from 'date-fns/locale';
import { computed } from 'vue';

// date-fns locale type
type DateFnsLocale = typeof enUS;

// Keyed by SupportedLocale so adding an app locale without its date-fns counterpart fails type-check
const localeMap: Record<SupportedLocale, DateFnsLocale> = {
  en: enUS,
  uk,
  es,
  de,
  sk,
  id,
  ru,
};

/**
 * Get the date-fns locale object for the current app locale.
 */
export function getDateFnsLocale(): DateFnsLocale {
  return localeMap[getValidLocale(getCurrentLocale())];
}

/**
 * Composable that provides locale-aware date formatting functions.
 * The locale automatically updates when the app locale changes.
 */
export function useDateLocale() {
  const locale = computed(() => getDateFnsLocale());

  /**
   * Format a date with automatic locale.
   * @see https://date-fns.org/docs/format
   */
  const format = (date: Date | number | string, formatStr: string, options?: Parameters<typeof dateFnsFormat>[2]) => {
    return dateFnsFormat(new Date(date), formatStr, {
      locale: locale.value,
      ...options,
    });
  };

  /**
   * Format distance between two dates with automatic locale.
   * @see https://date-fns.org/docs/formatDistance
   */
  const formatDistance = (
    date: Date | number,
    baseDate: Date | number,
    options?: Parameters<typeof dateFnsFormatDistance>[2],
  ) => {
    return dateFnsFormatDistance(date, baseDate, {
      locale: locale.value,
      ...options,
    });
  };

  /**
   * Format distance from now with automatic locale.
   * @see https://date-fns.org/docs/formatDistanceToNow
   */
  const formatDistanceToNow = (date: Date | number, options?: Parameters<typeof dateFnsFormatDistanceToNow>[1]) => {
    return dateFnsFormatDistanceToNow(date, {
      locale: locale.value,
      ...options,
    });
  };

  /**
   * Format relative time with automatic locale.
   * @see https://date-fns.org/docs/formatRelative
   */
  const formatRelative = (
    date: Date | number,
    baseDate: Date | number,
    options?: Parameters<typeof dateFnsFormatRelative>[2],
  ) => {
    return dateFnsFormatRelative(date, baseDate, {
      locale: locale.value,
      ...options,
    });
  };

  return {
    locale,
    format,
    formatDistance,
    formatDistanceToNow,
    formatRelative,
  };
}
