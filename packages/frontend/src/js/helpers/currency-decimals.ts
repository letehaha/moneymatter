import type { CurrencyMeta } from '@bt/shared/types';
import { shallowRef } from 'vue';

/** Decimals assumed for a code that neither the registry nor `Intl` knows. */
export const DEFAULT_CURRENCY_DECIMALS = 2;

// Replaced (never mutated) on every update, so formatters called from a template or
// computed re-render once the currency lists load.
// `registry` holds what the user's own currency lists say; `fallback` holds the owner's
// definitions that arrive on shared accounts, and is read only for codes the registry
// lacks (a viewer who never defined the code still sees it as the custom currency it is).
const registry = shallowRef<ReadonlyMap<string, CurrencyMeta>>(new Map());
const fallback = shallowRef<ReadonlyMap<string, CurrencyMeta>>(new Map());
// Set once the registry holds the full ISO catalogue, so a code it lacks can only be custom.
let isCatalogueLoaded = false;

const isValidDecimals = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Registers how each currency code is stored and displayed. Entries with an unusable
 * `decimals` are skipped; later entries for the same code win. `replace` drops every
 * earlier entry and marks the list as the full catalogue.
 */
export const registerCurrencyDecimals = ({
  entries,
  replace = false,
}: {
  entries: ReadonlyArray<{
    code: string;
    decimals: number | null | undefined;
    isCustom?: boolean;
    symbol?: string | null;
  }>;
  replace?: boolean;
}): void => {
  const next = new Map(replace ? [] : registry.value);
  entries.forEach(({ code, decimals, isCustom, symbol }) => {
    if (isValidDecimals(decimals)) next.set(code, { decimals, isCustom: isCustom ?? false, symbol: symbol ?? null });
  });
  if (replace) isCatalogueLoaded = true;
  registry.value = next;
};

/**
 * Replaces the owner definitions of the codes on shared accounts with the given list. They
 * fill only codes the user's own lists do not define; an explicit `meta` passed to the
 * formatters is what settles a code both sides define differently.
 */
export const registerFallbackCurrencyMeta = ({
  entries,
}: {
  entries: ReadonlyArray<{ code: string; meta: CurrencyMeta | null | undefined }>;
}): void => {
  const next = new Map<string, CurrencyMeta>();
  entries.forEach(({ code, meta }) => {
    if (meta && isValidDecimals(meta.decimals)) next.set(code, meta);
  });
  fallback.value = next;
};

export const resetCurrencyDecimals = (): void => {
  isCatalogueLoaded = false;
  registry.value = new Map();
  fallback.value = new Map();
};

const intlDecimalsCache = new Map<string, number | null>();

/** Decimals `Intl` (ISO 4217 / CLDR) knows for a code, or null for codes it rejects. */
const resolveIntlCurrencyDecimals = ({ code }: { code: string }): number | null => {
  const cached = intlDecimalsCache.get(code);
  if (cached !== undefined) return cached;

  let decimals: number | null;
  try {
    decimals =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ??
      DEFAULT_CURRENCY_DECIMALS;
  } catch {
    decimals = null;
  }
  intlDecimalsCache.set(code, decimals);
  return decimals;
};

/**
 * How a currency's amounts are shown. An explicit `meta` (the owner's definition carried by an
 * account or transaction) wins; then the user's own lists, the owner definitions seen on shared
 * accounts, the ISO value from `Intl`, and finally 2 decimals.
 */
export const resolveCurrencyDisplay = ({
  code,
  meta,
}: {
  code: string | null | undefined;
  meta?: CurrencyMeta | null;
}): CurrencyMeta => {
  if (meta && isValidDecimals(meta.decimals)) return meta;
  if (!code) return { decimals: DEFAULT_CURRENCY_DECIMALS, isCustom: false, symbol: null };

  const known = registry.value.get(code) ?? fallback.value.get(code);
  if (known) return known;

  const intlDecimals = resolveIntlCurrencyDecimals({ code });
  // Intl accepts any three letters, so once the catalogue is in, a code it lacks is custom.
  return {
    decimals: intlDecimals ?? DEFAULT_CURRENCY_DECIMALS,
    isCustom: isCatalogueLoaded || intlDecimals === null,
    symbol: null,
  };
};

/** Decimals a currency's amounts carry (see `resolveCurrencyDisplay` for the order). */
export const getCurrencyDecimals = ({
  code,
  meta,
}: {
  code: string | null | undefined;
  meta?: CurrencyMeta | null;
}): number => resolveCurrencyDisplay({ code, meta }).decimals;

/** One minor unit of the currency: the smallest amount it can carry (0.01 USD, 1 JPY). */
export const getSmallestCurrencyUnit = ({
  code,
  meta,
}: {
  code: string | null | undefined;
  meta?: CurrencyMeta | null;
}): number => 10 ** -getCurrencyDecimals({ code, meta });

/** True when `Intl` can format the code in currency style (ISO codes). */
export const isIntlCurrencyCode = ({ code }: { code: string }): boolean =>
  resolveIntlCurrencyDecimals({ code }) !== null;

/**
 * Strips float noise from a sum or difference of amounts that already carry at most
 * `decimals` digits (0.1 + 0.2 → 0.3). It is not a rounding mode for user input.
 */
export const trimAmountNoise = ({ value, decimals }: { value: number; decimals: number }): number =>
  Number(value.toFixed(decimals));

/** Moves the decimal point via the exponent, so 1.005 shifts to exactly 100.5, not 100.49999999999999. */
const shiftDecimalPoint = ({ value, by }: { value: number; by: number }): number => {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Number(`${mantissa}e${Number(exponent) + by}`);
};

/**
 * Rounds a computed amount (a conversion, an estimate, a share at a rate) half-up, away
 * from zero, to `decimals` digits, like the backend's `Money.round`.
 */
export const roundToDecimals = ({ value, decimals }: { value: number; decimals: number }): number => {
  const rounded = shiftDecimalPoint({
    value: Math.round(shiftDecimalPoint({ value: Math.abs(value), by: decimals })),
    by: -decimals,
  });
  return value < 0 && rounded !== 0 ? -rounded : rounded;
};
