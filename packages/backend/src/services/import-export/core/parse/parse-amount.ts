import Big from 'big.js';

/** The numeric prefix of a cleaned amount token, with an optional exponent. */
const LEADING_NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/**
 * Parse an amount string and return its exact decimal value as a plain string (`'-12.345'`).
 * Nothing is rounded: every digit the source wrote is kept, and the caller rounds to the
 * account currency's decimals where the amount meets a stored one. The string never uses
 * exponent notation and a zero is always `'0'`.
 * Supports various formats: 1234.56, 1,234.56, -1234.56, (1234.56)
 *
 * New code should use `parseDecimalAmount`, which rejects ambiguous tokens. This one always
 * guesses: a lone comma is read as the decimal point, so `1,234` returns `'1.234'`.
 */
export function parseAmount(amountStr: string): string | null {
  if (!amountStr) return null;

  // Banks export U+2212 minus, en/em dashes, and other hyphen look-alikes as the sign
  let cleanStr = amountStr.trim().replace(/^[‐-―−﹣－]/, '-');

  // Handle parentheses as negative (accounting format)
  const isNegativeParens = cleanStr.startsWith('(') && cleanStr.endsWith(')');
  if (isNegativeParens) {
    cleanStr = cleanStr.slice(1, -1);
  }

  // Handle explicit negative sign
  const isNegativeSign = cleanStr.startsWith('-');
  if (isNegativeSign) {
    cleanStr = cleanStr.slice(1);
  }

  // Handle explicit positive sign
  if (cleanStr.startsWith('+')) {
    cleanStr = cleanStr.slice(1);
  }

  // Remove currency symbols and spaces
  cleanStr = cleanStr.replace(/[$€£¥₴₽\s]/g, '');

  // Determine decimal separator
  // If string has both comma and period, the last one is the decimal separator
  const lastComma = cleanStr.lastIndexOf(',');
  const lastPeriod = cleanStr.lastIndexOf('.');

  if (lastComma > lastPeriod) {
    // European format: 1.234,56 -> 1234.56
    cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK format: 1,234.56 -> 1234.56
    cleanStr = cleanStr.replace(/,/g, '');
  }

  // Read the leading number and ignore a trailing remainder, the way `parseFloat` does
  const leadingNumber = LEADING_NUMBER.exec(cleanStr)?.[0];

  if (leadingNumber === undefined) {
    return null;
  }

  const magnitude = new Big(leadingNumber);

  if (magnitude.eq(0)) {
    return '0';
  }

  // Apply negative sign
  return (isNegativeParens || isNegativeSign ? magnitude.neg() : magnitude).toFixed();
}
