import type { CurrencyDisplayPreference } from '@bt/shared/types';
import { ref } from 'vue';

export const formatFiat = (value: unknown): string => Number(value).toFixed(2);

// Module-level so plain helpers, not just composables, follow the user's setting.
export const currencyDisplayPreference = ref<CurrencyDisplayPreference>('symbol');

export function toLocalNumber(
  value: string | number | undefined | null,
  options: Intl.NumberFormatOptions & {
    locale?: Intl.LocalesArgument;
  } = {},
): string {
  if (value !== undefined && value !== null) {
    return Number(value).toLocaleString(options.locale ?? 'en-US', {
      ...options,
      maximumFractionDigits: options.maximumFractionDigits ?? 5,
      minimumFractionDigits: options.minimumFractionDigits ?? 2,
    });
  }
  return String(value);
}

// Fraction digits a fiat currency renders per ISO-4217/CLDR (KRW→0, USD→2, BHD→3),
// clamped to 2 because Money stores cents (×100) so only 2 decimals are ever real.
// Codes Intl rejects (malformed, e.g. a stray ticker from DB data) resolve to null so
// callers can skip currency-styled formatting instead of crashing the render. Cached —
// building an Intl formatter per render is costly.
const currencyFractionDigitsCache = new Map<string, number | null>();

function resolveCurrencyDigits(currency: string): number | null {
  const cached = currencyFractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;

  let digits: number | null;
  try {
    const cldrDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    digits = Math.min(cldrDigits ?? 2, 2);
  } catch {
    digits = null;
  }

  currencyFractionDigitsCache.set(currency, digits);
  return digits;
}

function toLocalFiatCurrency(
  value: string | number | undefined | null,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value !== undefined && value !== null) {
    const currency = options.currency || 'USD';
    const currencyDigits = resolveCurrencyDigits(currency);
    // Intl rejects the code — render a bare 2-decimal number with the code appended
    // instead of letting toLocaleString throw a RangeError mid-render.
    if (currencyDigits === null) {
      return `${toLocalNumber(value, {
        minimumFractionDigits: options.minimumFractionDigits ?? 2,
        maximumFractionDigits: options.maximumFractionDigits ?? 2,
        useGrouping: options.useGrouping ?? true,
      })} ${currency}`;
    }
    return toLocalNumber(value, {
      ...options,
      minimumFractionDigits: options.minimumFractionDigits ?? currencyDigits,
      maximumFractionDigits: options.maximumFractionDigits ?? currencyDigits,
      currency,
      currencyDisplay: options.currencyDisplay ?? currencyDisplayPreference.value,
      useGrouping: options.useGrouping ?? true,
      style: 'currency',
    });
  }
  return String(value);
}

/**
 * Bare amount (no symbol) with the fraction digits its currency uses — for the
 * "1,500 KRW" layout where the code is rendered separately. KRW → "1,500", USD →
 * "1,500.00". Unknown/non-ISO codes fall back to 2.
 */
export function toLocalCurrencyNumber(
  value: string | number | undefined | null,
  options: Omit<Intl.NumberFormatOptions, 'style' | 'currency' | 'currencyDisplay'> & {
    /** ISO-4217 code whose fraction digits to apply; only affects digits, never adds a symbol. */
    currency?: string;
    locale?: Intl.LocalesArgument;
  } = {},
): string {
  const { currency, ...numberOptions } = options;
  const digits = resolveCurrencyDigits(currency || 'USD') ?? 2;
  return toLocalNumber(value, {
    ...numberOptions,
    minimumFractionDigits: numberOptions.minimumFractionDigits ?? digits,
    maximumFractionDigits: numberOptions.maximumFractionDigits ?? digits,
  });
}

/**
 * Format large numbers to be like:
 *
 * 1,000 - 9,999
 * 100,000 / 100k - 999,999 / 999.99k
 * 100,000,000 / 100m - 999,999,999 / 999.99m
 * @param {number} value - The number to format
 * @param {string} options.thousandSuffix - suffix for thousands
 * @param {string} options.millionSuffix - suffix for millions
 * @param {string} options.billionSuffix - suffix for billions
 * @param {number} options.maximumFractionDigits - maximum fraction digits
 * @param {number} options.minimumFractionDigits - minimum fraction digits
 * @param {number} options.thousandThreshold - threshold for thousands
 * @param {number} options.millionThreshold - threshold for millions
 * @param {number} options.billionThreshold - threshold for billions
 *
 * @param {boolean} options.isFiat - add fiat currency symbol and formatting
 * @param {string} options.currency - fiat currency symbol
 */
export function formatLargeNumber(
  value: number | string,
  options: Pick<Intl.NumberFormatOptions, 'maximumFractionDigits' | 'minimumFractionDigits' | 'currency'> & {
    millionSuffix?: string;
    thousandSuffix?: string;
    billionSuffix?: string;
    thousandThreshold?: number;
    millionThreshold?: number;
    billionThreshold?: number;
    // Solana lamports
    lamports?: boolean;
    isFiat?: boolean;
  } = {},
) {
  const suffixes = {
    millionSuffix: options.millionSuffix ?? 'M',
    thousandSuffix: options.thousandSuffix ?? 'k',
    billionSuffix: options.billionSuffix ?? 'B',
  };

  const thresholds = {
    thousandThreshold: options.thousandThreshold ?? 1_000,
    millionThreshold: options.millionThreshold ?? 1_000_000,
    billionThreshold: options.billionThreshold ?? 1_000_000_000,
  };

  let localNumber = Number(Math.floor(Number(value)));

  // Truncating floating numbers
  if (Number.isNaN(localNumber)) localNumber = 0;
  let delimiter = 1;
  let suffix = '';
  if (options.lamports) {
    localNumber /= 1_000_000_000;
  }
  const abs = Math.abs(localNumber);

  if (abs >= thresholds.billionThreshold) {
    delimiter = 1_000_000_000;
    suffix = suffixes.billionSuffix;
  } else if (abs >= thresholds.millionThreshold) {
    delimiter = 1_000_000;
    suffix = suffixes.millionSuffix;
  } else if (abs >= thresholds.thousandThreshold) {
    delimiter = 1_000;
    suffix = suffixes.thousandSuffix;
  }

  const formatterFunc = options.isFiat ? toLocalFiatCurrency : toLocalNumber;

  // Fraction digits here are scale digits ("₩12.35k" = ₩12,350), not currency sub-units,
  // so per-currency digit resolution deliberately doesn't apply.
  const formatted = formatterFunc(localNumber / delimiter, {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    currency: options.currency,
  });
  return `${formatted}${suffix}`;
}

const COMPACT_SIGNIFICANT_DIGITS = 3;

// Rounds before the suffix is picked, so 999,600 reads "$1M" rather than "$1,000K".
export const formatCompactFiat = ({ amount, currency }: { amount: number; currency?: string }) =>
  formatLargeNumber(Number(amount.toPrecision(COMPACT_SIGNIFICANT_DIGITS)), {
    isFiat: true,
    currency,
    thousandSuffix: 'K',
  });

export function formatUIAmount(
  value: number,
  {
    currency,
    fractionDigits,
  }: {
    currency?: Intl.NumberFormatOptions['currency'];
    fractionDigits?: number;
  } = {},
): string {
  if (!Number.isFinite(value)) return String(value);

  return toLocalFiatCurrency(value, {
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
