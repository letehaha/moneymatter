import { shallowRef } from 'vue';

/** Decimals assumed for a code that neither the registry nor `Intl` knows. */
export const DEFAULT_CURRENCY_DECIMALS = 2;

// Replaced (never mutated) on every update, so formatters called from a template or
// computed re-render once the currency lists load.
const registry = shallowRef<ReadonlyMap<string, number>>(new Map());

const isValidDecimals = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Registers the decimals each currency code is stored and displayed with. Entries
 * with an unusable `decimals` are skipped; later entries for the same code win.
 */
export const registerCurrencyDecimals = ({
  entries,
}: {
  entries: ReadonlyArray<{ code: string; decimals: number | null | undefined }>;
}): void => {
  const next = new Map(registry.value);
  entries.forEach(({ code, decimals }) => {
    if (isValidDecimals(decimals)) next.set(code, decimals);
  });
  registry.value = next;
};

export const resetCurrencyDecimals = (): void => {
  registry.value = new Map();
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

/**
 * Decimals a currency's amounts carry: the registered value (what the backend stores
 * for the code) first, then the ISO value from `Intl`, then 2.
 */
export const getCurrencyDecimals = ({ code }: { code: string | null | undefined }): number => {
  if (!code) return DEFAULT_CURRENCY_DECIMALS;
  return registry.value.get(code) ?? resolveIntlCurrencyDecimals({ code }) ?? DEFAULT_CURRENCY_DECIMALS;
};

/** True when `Intl` can format the code in currency style (ISO codes). */
export const isIntlCurrencyCode = ({ code }: { code: string }): boolean =>
  resolveIntlCurrencyDecimals({ code }) !== null;

/**
 * Strips float noise from a sum or difference of amounts that already carry at most
 * `decimals` digits (0.1 + 0.2 → 0.3). It is not a rounding mode for user input.
 */
export const trimAmountNoise = ({ value, decimals }: { value: number; decimals: number }): number =>
  Number(value.toFixed(decimals));
