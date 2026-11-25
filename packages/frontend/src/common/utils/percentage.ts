/**
 * Conversion helpers between **fractions** (stored, e.g. `0.085`) and
 * **percent strings** (user-facing, e.g. `"8.5"` or `"8.5%"`). The API/DB use
 * fractions; UI inputs and display use percent.
 *
 * Multiplications/divisions by 100 are routed through `.toFixed(10)` to strip
 * IEEE-754 noise (`0.07 * 100 === 7.000000000000001`) before stringifying.
 */

const FP_PRECISION = 10;

const parseFinite = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const cleanNumberToString = (num: number): string => Number(num.toFixed(FP_PRECISION)).toString();

interface FormatFractionAsPercentOptions {
  /** Max fraction digits when not stripping trailing zeros. Default 2. */
  maximumFractionDigits?: number;
  /** When true, drop trailing zeros (e.g. `"8.5%"` not `"8.50%"`). Default true. */
  stripTrailingZeros?: boolean;
  /** String returned when the input is null/undefined/non-finite. Default `"—"`. */
  fallback?: string;
}

/** Stored fraction → display percent string (`"0.085"` → `"8.5%"`). */
export function formatFractionAsPercent(
  fraction: string | number | null | undefined,
  options: FormatFractionAsPercentOptions = {},
): string {
  const { maximumFractionDigits = 2, stripTrailingZeros = true, fallback = '—' } = options;
  const num = parseFinite(fraction);
  if (num === null) return fallback;
  const formatted = (num * 100).toFixed(maximumFractionDigits);
  const trimmed = stripTrailingZeros ? formatted.replace(/\.?0+$/, '') : formatted;
  return `${trimmed}%`;
}

/** Stored fraction → percent text-input value (`"0.085"` → `"8.5"`). */
export function fractionToPercentInput(fraction: string | number | null | undefined): string {
  const num = parseFinite(fraction);
  if (num === null) return '0';
  return cleanNumberToString(num * 100);
}

/** Percent text-input value → stored fraction (`"8.5"` → `"0.085"`). */
export function percentInputToFraction(percentInput: string | number | null | undefined): string {
  const num = parseFinite(percentInput);
  if (num === null) return '0';
  return cleanNumberToString(num / 100);
}

/** `val` parses to a finite number in [0, 100]. */
export function isPercentInputValid(val: string): boolean {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/** Unsigned share with one decimal (`0.123` → `"12.3%"`); `—` when not finite. */
export const formatShare = ({ fraction }: { fraction: number | null }) =>
  formatFractionAsPercent(fraction, { maximumFractionDigits: 1, stripTrailingZeros: false });

/** Signed percent with two decimals (`0.05` → `"+5.00%"`); `—` when not finite. */
export const formatSignedPercent = ({ fraction }: { fraction: number | null }) => {
  const text = formatFractionAsPercent(fraction, { maximumFractionDigits: 2, stripTrailingZeros: false });
  return fraction !== null && Number.isFinite(fraction) && fraction >= 0 ? `+${text}` : text;
};
