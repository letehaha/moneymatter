import type { CurrencyDisplayPreference, CurrencyMeta } from '@bt/shared/types';
import { ref } from 'vue';

import { isIntlCurrencyCode, resolveCurrencyDisplay } from './currency-decimals';

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

function toLocalFiatCurrency(
  value: string | number | undefined | null,
  options: Intl.NumberFormatOptions & {
    /** The owner's definition of the currency (carried by an account or transaction). */
    meta?: CurrencyMeta | null;
  } = {},
): string {
  if (value !== undefined && value !== null) {
    const { meta, ...intlOptions } = options;
    const currency = intlOptions.currency || 'USD';
    const display = resolveCurrencyDisplay({ code: currency, meta });
    const currencyDigits = display.decimals;
    // A custom code (or one Intl rejects as malformed) renders as a plain number with the
    // currency's own decimals plus its symbol or code, never in `Intl` currency style: Intl
    // accepts any three letters ("SAT", "BTC") and would apply its own digits and a `¤` sign.
    if (display.isCustom || !isIntlCurrencyCode({ code: currency })) {
      const label = display.symbol || currency;
      return `${toLocalNumber(value, {
        minimumFractionDigits: intlOptions.minimumFractionDigits ?? currencyDigits,
        maximumFractionDigits: intlOptions.maximumFractionDigits ?? currencyDigits,
        useGrouping: intlOptions.useGrouping ?? true,
      })} ${label}`;
    }
    return toLocalNumber(value, {
      ...intlOptions,
      minimumFractionDigits: intlOptions.minimumFractionDigits ?? currencyDigits,
      maximumFractionDigits: intlOptions.maximumFractionDigits ?? currencyDigits,
      currency,
      currencyDisplay: intlOptions.currencyDisplay ?? currencyDisplayPreference.value,
      useGrouping: intlOptions.useGrouping ?? true,
      style: 'currency',
    });
  }
  return String(value);
}

/**
 * Bare amount (no symbol) with the fraction digits its currency uses — for the
 * "1,500 KRW" layout where the code is rendered separately. KRW → "1,500", USD →
 * "1,500.00", KWD → "1,500.000". Codes without registered decimals fall back to the
 * ISO value, then to 2.
 */
export function toLocalCurrencyNumber(
  value: string | number | undefined | null,
  options: Omit<Intl.NumberFormatOptions, 'style' | 'currency' | 'currencyDisplay'> & {
    /** Currency code whose fraction digits to apply; only affects digits, never adds a symbol. */
    currency?: string;
    /** The owner's definition of the currency; its decimals win over the registered ones. */
    meta?: CurrencyMeta | null;
    locale?: Intl.LocalesArgument;
  } = {},
): string {
  const { currency, meta, ...numberOptions } = options;
  const digits = resolveCurrencyDisplay({ code: currency || 'USD', meta }).decimals;
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

/** Full amount under 1,000, K/M/B suffix from there up. */
export const formatShortFiat = ({ amount, currency }: { amount: number; currency?: string }) =>
  Math.abs(amount) >= 1_000 ? formatCompactFiat({ amount, currency }) : formatUIAmount(amount, { currency });

export function formatUIAmount(
  value: number,
  {
    currency,
    fractionDigits,
    meta,
  }: {
    currency?: Intl.NumberFormatOptions['currency'];
    fractionDigits?: number;
    /** The owner's definition of the currency; pass the account's `currencyMeta` for its amounts. */
    meta?: CurrencyMeta | null;
  } = {},
): string {
  if (!Number.isFinite(value)) return String(value);

  // `|| 0` turns -0 into 0 so it doesn't render as "-$0.00".
  return toLocalFiatCurrency(value || 0, {
    currency,
    meta,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
