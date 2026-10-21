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

const isValidDecimals = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

interface CurrencyRegistryEntry {
  code: string;
  decimals: number | null | undefined;
  /** True for a user-defined code, which never renders in `Intl` currency style. */
  isCustom?: boolean;
  symbol?: string | null;
}

const toMeta = ({ entry }: { entry: CurrencyRegistryEntry & { decimals: number } }): CurrencyMeta => ({
  decimals: entry.decimals,
  isCustom: entry.isCustom ?? false,
  symbol: entry.symbol ?? null,
});

/**
 * Registers the decimals each currency code is stored and displayed with. Entries
 * with an unusable `decimals` are skipped; later entries for the same code win.
 */
export const registerCurrencyDecimals = ({ entries }: { entries: ReadonlyArray<CurrencyRegistryEntry> }): void => {
  const next = new Map(registry.value);
  entries.forEach((entry) => {
    if (isValidDecimals(entry.decimals))
      next.set(entry.code, toMeta({ entry: { ...entry, decimals: entry.decimals } }));
  });
  registry.value = next;
};

/**
 * Registers the owner's definition of a code as it arrives on shared accounts. It fills
 * only codes the user's own lists do not define; an explicit `meta` passed to the
 * formatters is what settles a code both sides define differently.
 */
export const registerFallbackCurrencyMeta = ({
  entries,
}: {
  entries: ReadonlyArray<{ code: string; meta: CurrencyMeta | null | undefined }>;
}): void => {
  const next = new Map(fallback.value);
  entries.forEach(({ code, meta }) => {
    if (meta && isValidDecimals(meta.decimals)) next.set(code, meta);
  });
  fallback.value = next;
};

export const resetCurrencyDecimals = (): void => {
  registry.value = new Map();
  fallback.value = new Map();
};

const intlDecimalsCache = new Map<string, number | null>();

/** Decimals `Intl` (ISO 4217 / CLDR) knows for a code, or null for codes it rejects. */
export const resolveIntlCurrencyDecimals = ({ code }: { code: string }): number | null => {
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

export interface CurrencyDisplay {
  decimals: number;
  /** User-defined code: rendered as a plain number plus symbol or code, never in `Intl` currency style. */
  isCustom: boolean;
  symbol: string | null;
}

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
}): CurrencyDisplay => {
  if (meta && isValidDecimals(meta.decimals)) {
    return { decimals: meta.decimals, isCustom: meta.isCustom, symbol: meta.symbol };
  }
  if (!code) return { decimals: DEFAULT_CURRENCY_DECIMALS, isCustom: false, symbol: null };

  const known = registry.value.get(code) ?? fallback.value.get(code);
  if (known) return { decimals: known.decimals, isCustom: known.isCustom, symbol: known.symbol };

  const intlDecimals = resolveIntlCurrencyDecimals({ code });
  return { decimals: intlDecimals ?? DEFAULT_CURRENCY_DECIMALS, isCustom: intlDecimals === null, symbol: null };
};

/** Decimals a currency's amounts carry (see `resolveCurrencyDisplay` for the order). */
export const getCurrencyDecimals = ({
  code,
  meta,
}: {
  code: string | null | undefined;
  meta?: CurrencyMeta | null;
}): number => resolveCurrencyDisplay({ code, meta }).decimals;

/** True when `Intl` can format the code in currency style (ISO codes). */
export const isIntlCurrencyCode = ({ code }: { code: string }): boolean =>
  resolveIntlCurrencyDecimals({ code }) !== null;

/**
 * Strips float noise from a sum or difference of amounts that already carry at most
 * `decimals` digits (0.1 + 0.2 → 0.3). It is not a rounding mode for user input.
 */
export const trimAmountNoise = ({ value, decimals }: { value: number; decimals: number }): number =>
  Number(value.toFixed(decimals));
