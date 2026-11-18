/** Spacing marks used as thousands separators: plain, non-breaking and thin spaces, and the Swiss apostrophe. */
const GROUPING_WHITESPACE = /[\s  ']/g;

const THOUSANDS_GROUP_SIZE = 3;

function digitsAfter({ value, separatorIndex }: { value: string; separatorIndex: number }): number {
  return value.length - separatorIndex - 1;
}

/**
 * Removes `separator` when the first group is 1-3 digits and every later group exactly three.
 * Null otherwise, which means the mark never separated thousands and the whole token is
 * malformed.
 */
export function stripThousandsSeparator({ value, separator }: { value: string; separator: string }): string | null {
  const [first, ...rest] = value.split(separator);
  if (first === undefined) return null;
  if (rest.length === 0) return first;

  const allGroupsWellFormed = /^\d{1,3}$/.test(first) && rest.every((group) => /^\d{3}$/.test(group));

  return allGroupsWellFormed ? first + rest.join('') : null;
}

/**
 * Reads an amount written in any common convention (`1,234.56`, `1.234,56`, `1 234,56`,
 * `1'234.56`) into a plain number. Null when the text is not an amount, or when a lone
 * separator sits before exactly three digits: `1,234` is 1234 to a US bank and 1.234 to a
 * European one, and nothing in the token says which.
 */
export function parseDecimalAmount({ raw }: { raw: string }): number | null {
  const compact = raw.replace(GROUPING_WHITESPACE, '');

  // Digits and separators only. Cutting off a currency symbol or a trailing unit would
  // invent an amount the source never wrote.
  if (!/^[\d.,]+$/.test(compact) || !/\d/.test(compact)) return null;

  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');

  let normalized: string | null;

  if (lastDot >= 0 && lastComma >= 0) {
    // Both marks present, so the later one is the decimal point and the other groups digits
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    const [whole, fraction] = splitOnLast({ value: compact, separator: decimalSeparator });
    const wholeDigits = stripThousandsSeparator({ value: whole, separator: thousandsSeparator });

    normalized = wholeDigits === null ? null : `${wholeDigits}.${fraction}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? '.' : ',';
    const separatorIndex = lastDot >= 0 ? lastDot : lastComma;
    const occurrences = compact.split(separator).length - 1;

    if (occurrences > 1) {
      // Repeated, so it can only be grouping digits
      normalized = stripThousandsSeparator({ value: compact, separator });
    } else if (digitsAfter({ value: compact, separatorIndex }) === THOUSANDS_GROUP_SIZE && separatorIndex > 0) {
      normalized = null;
    } else {
      normalized = compact.replace(separator, '.');
    }
  } else {
    normalized = compact;
  }

  if (normalized === null || !/^\d*\.?\d+$/.test(normalized)) return null;

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

function splitOnLast({ value, separator }: { value: string; separator: string }): [string, string] {
  const index = value.lastIndexOf(separator);
  return [value.slice(0, index), value.slice(index + 1)];
}
