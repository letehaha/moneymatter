import type { CurrencyDisplayPreference, CurrencyMeta } from '@bt/shared/types';
import { useLocalStorage } from '@vueuse/core';
import { ref } from 'vue';

import { isIntlCurrencyCode, resolveCurrencyDisplay } from './currency-decimals';

export const formatFiat = (value: unknown): string => Number(value).toFixed(2);

// Module-level so plain helpers, not just composables, follow the user's setting.
export const currencyDisplayPreference = ref<CurrencyDisplayPreference>('symbol');
export const areAmountsHidden = useLocalStorage('amounts:hidden', false);
const numberFormatLocale = ref('en-US');

const HIDDEN_AMOUNT = '••••';

/** Already-formatted money text, or `••••` while amounts are hidden. */
export const maskAmountText = ({ text }: { text: string }): string => (areAmountsHidden.value ? HIDDEN_AMOUNT : text);

export function toLocalNumber(
  value: string | number | undefined | null,
  options: Intl.NumberFormatOptions & {
    locale?: Intl.LocalesArgument;
  } = {},
): string {
  if (value !== undefined && value !== null) {
    return Number(value).toLocaleString(options.locale ?? numberFormatLocale.value, {
      ...options,
      maximumFractionDigits: options.maximumFractionDigits ?? 5,
      minimumFractionDigits: options.minimumFractionDigits ?? 2,
    });
  }
  return String(value);
}

const DISPLAY_SIGNIFICANT_DIGITS = 4;
const DISPLAY_MIN_FRACTION_DIGITS = 2;

const rendersAsPlainNumber = ({ code, display }: { code: string; display: CurrencyMeta }) =>
  display.isCustom || !isIntlCurrencyCode({ code });

/**
 * Fraction digits of a custom currency's amount: 4 significant digits, never fewer than 2 decimals
 * nor more than the currency carries, trailing zeros trimmed down to 2.
 * 1 → "1.00", 1.23456789 → "1.235", 0.00012345 → "0.0001235", 1234.5678 → "1,234.57".
 * `fullPrecision` keeps every digit the currency carries, still trimming trailing zeros.
 */
const getCustomFractionDigits = ({
  value,
  decimals,
  fullPrecision = false,
}: {
  value: number;
  decimals: number;
  fullPrecision?: boolean;
}): { minimumFractionDigits: number; maximumFractionDigits: number } => {
  const minimumFractionDigits = Math.min(DISPLAY_MIN_FRACTION_DIGITS, decimals);
  if (fullPrecision) return { minimumFractionDigits, maximumFractionDigits: decimals };
  const abs = Math.abs(value);
  if (!abs || !Number.isFinite(abs)) return { minimumFractionDigits, maximumFractionDigits: minimumFractionDigits };
  const significantFractionDigits = DISPLAY_SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(abs));
  return {
    minimumFractionDigits,
    maximumFractionDigits: Math.min(decimals, Math.max(minimumFractionDigits, significantFractionDigits)),
  };
};

type RevealOption = {
  /** Shown even while amounts are hidden: what the user is typing and its previews. */
  revealed?: boolean;
};

function toLocalFiatCurrency(
  value: string | number | undefined | null,
  options: Intl.NumberFormatOptions & {
    /** The owner's definition of the currency (carried by an account or transaction). */
    meta?: CurrencyMeta | null;
    /** Scale suffix ("k", "M"), placed after the number and before a custom currency's label. */
    suffix?: string;
    /** Every digit a custom currency carries instead of its shortened display. */
    fullPrecision?: boolean;
  } & RevealOption = {},
): string {
  const { revealed, ...restOptions } = options;
  if (areAmountsHidden.value && !revealed && value !== undefined && value !== null) return HIDDEN_AMOUNT;
  if (value !== undefined && value !== null) {
    const { meta, suffix = '', fullPrecision, ...intlOptions } = restOptions;
    const currency = intlOptions.currency || 'USD';
    const display = resolveCurrencyDisplay({ code: currency, meta });
    const currencyDigits = display.decimals;
    // A custom code (or one Intl rejects as malformed) renders as a plain number plus its symbol
    // or code, never in `Intl` currency style: Intl accepts any three letters ("SAT", "BTC") and
    // would apply its own digits and a `¤` sign.
    if (rendersAsPlainNumber({ code: currency, display })) {
      const label = display.symbol || currency;
      const digits = getCustomFractionDigits({ value: Number(value), decimals: currencyDigits, fullPrecision });
      return `${toLocalNumber(value, {
        minimumFractionDigits: intlOptions.minimumFractionDigits ?? digits.minimumFractionDigits,
        maximumFractionDigits: intlOptions.maximumFractionDigits ?? digits.maximumFractionDigits,
        useGrouping: intlOptions.useGrouping ?? true,
      })}${suffix} ${label}`;
    }
    return `${toLocalNumber(value, {
      ...intlOptions,
      minimumFractionDigits: intlOptions.minimumFractionDigits ?? currencyDigits,
      maximumFractionDigits: intlOptions.maximumFractionDigits ?? currencyDigits,
      currency,
      currencyDisplay: intlOptions.currencyDisplay ?? currencyDisplayPreference.value,
      useGrouping: intlOptions.useGrouping ?? true,
      style: 'currency',
    })}${suffix}`;
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
    /** Every digit a custom currency carries instead of its shortened display. */
    fullPrecision?: boolean;
  } & RevealOption = {},
): string {
  const { currency, meta, fullPrecision, revealed, ...numberOptions } = options;
  if (areAmountsHidden.value && !revealed && value !== undefined && value !== null) return HIDDEN_AMOUNT;
  const code = currency || 'USD';
  const display = resolveCurrencyDisplay({ code, meta });
  const digits = rendersAsPlainNumber({ code, display })
    ? getCustomFractionDigits({ value: Number(value), decimals: display.decimals, fullPrecision })
    : { minimumFractionDigits: display.decimals, maximumFractionDigits: display.decimals };
  return toLocalNumber(value, {
    ...numberOptions,
    minimumFractionDigits: numberOptions.minimumFractionDigits ?? digits.minimumFractionDigits,
    maximumFractionDigits: numberOptions.maximumFractionDigits ?? digits.maximumFractionDigits,
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
    meta?: CurrencyMeta | null;
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

  // Fraction digits here are scale digits ("₩12.35k" = ₩12,350), not currency sub-units,
  // so per-currency digit resolution deliberately doesn't apply.
  const digits = {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  };
  if (options.isFiat)
    return toLocalFiatCurrency(localNumber / delimiter, {
      ...digits,
      currency: options.currency,
      meta: options.meta,
      suffix,
    });

  return `${toLocalNumber(localNumber / delimiter, digits)}${suffix}`;
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

const compactRoundingStep = (abs: number) => (abs >= 1e9 ? 1e7 : abs >= 1e6 ? 1e4 : abs >= 1e5 ? 1e3 : 10);

/**
 * Full amount with cents under `from` (default 10,000). From there k/M/B with up to 2 decimals
 * ("₴42.6k", "₴1.24M"), except 100k–1M, which drops them ("₴385k").
 */
export const formatCompactUIAmount = ({
  amount,
  currency,
  meta,
  from = 10_000,
}: {
  amount: number;
  currency?: string;
  meta?: CurrencyMeta | null;
  from?: number;
}) => {
  if (!(Math.abs(amount) >= from)) return formatUIAmount(amount, { currency, meta });

  // Rounds before the suffix is picked, so 999,600 reads "₴1M" rather than "₴1000k".
  const step = compactRoundingStep(Math.abs(amount));
  const rounded = Math.round(amount / step) * step;
  const abs = Math.abs(rounded);

  return formatLargeNumber(rounded, {
    isFiat: true,
    currency,
    meta,
    minimumFractionDigits: 0,
    maximumFractionDigits: abs >= 100_000 && abs < 1_000_000 ? 0 : 2,
  });
};

/** Whole units under 1,000, then K/M/B with at most one decimal ("$813", "$7.8K", "$1.2M"). */
export const formatTinyUIAmount = ({ amount, currency }: { amount: number; currency?: string }) => {
  const whole = Math.round(amount);
  const abs = Math.abs(whole);
  if (!(abs >= 1_000)) return formatUIAmount(whole, { currency, fractionDigits: 0 });

  // Rounds before the suffix is picked, so 999,960 reads "$1M" rather than "$1000K".
  const step = abs >= 1e6 ? 1e5 : 100;
  return formatLargeNumber(Math.round(amount / step) * step, {
    isFiat: true,
    currency,
    thousandSuffix: 'K',
    maximumFractionDigits: 1,
  });
};

export function formatUIAmount(
  value: number,
  {
    currency,
    fractionDigits,
    meta,
    fullPrecision,
    revealed,
  }: RevealOption & {
    currency?: Intl.NumberFormatOptions['currency'];
    fractionDigits?: number;
    /** The owner's definition of the currency; pass the account's `currencyMeta` for its amounts. */
    meta?: CurrencyMeta | null;
    /** Every digit a custom currency carries instead of its shortened display. */
    fullPrecision?: boolean;
  } = {},
): string {
  if (!Number.isFinite(value)) return String(value);

  // `|| 0` turns -0 into 0 so it doesn't render as "-$0.00".
  return toLocalFiatCurrency(value || 0, {
    currency,
    meta,
    fullPrecision,
    revealed,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** An amount in an account's (or transaction's) currency, formatted by the owner's definition of it. */
export const formatAccountAmount = ({
  amount,
  account,
  fullPrecision,
}: {
  amount: number;
  account: { currencyCode: string; currencyMeta?: CurrencyMeta | null };
  fullPrecision?: boolean;
}): string => formatUIAmount(amount, { currency: account.currencyCode, meta: account.currencyMeta, fullPrecision });
