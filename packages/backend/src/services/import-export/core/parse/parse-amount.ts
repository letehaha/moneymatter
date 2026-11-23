import Big from 'big.js';

import { stripThousandsSeparator } from './parse-decimal-amount';

/** The numeric prefix of a cleaned amount token; group 1 is the optional exponent, kept as text. */
const LEADING_NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?/i;

/**
 * Largest exponent magnitude accepted. `toFixed()` writes out every digit, so an unbounded
 * exponent (`1e999999999`) would build a string of that many characters. 30 is far beyond
 * anything a DECIMAL(36,18) column can hold.
 */
const MAX_EXPONENT = 30;

/**
 * Parse an amount string and return its exact decimal value as a plain string (`'-12.345'`).
 * Nothing is rounded: every digit the source wrote is kept, and the caller rounds to the
 * account currency's decimals where the amount meets a stored one. The string never uses
 * exponent notation and a zero is always `'0'`.
 * Supports various formats: 1234.56, 1,234.56, -1234.56, (1234.56), 1234.56 DR, 1234.56 CR.
 * A DR/CR suffix next to a sign or parentheses is contradictory and unparseable. An exponent
 * beyond +-30 (`1e999999999`) makes the token unparseable instead of expanding it.
 *
 * New code should use `parseDecimalAmount`, which rejects ambiguous tokens. This one always
 * guesses: a lone comma is read as the decimal point, so `1,234` returns `'1.234'`.
 */
export function parseAmount(amountStr: string): string | null {
  if (!amountStr) return null;

  // Banks export U+2212 minus, en/em dashes, and other hyphen look-alikes as the sign
  let cleanStr = amountStr.trim().replace(/^[\u2010-\u2015\u2212\uFE63\uFF0D]/, '-');

  // Bank statements mark debits and credits with a `DR` / `CR` suffix instead of a sign
  const suffix = /(?<![a-z])\s*(DR|CR)\.?$/i.exec(cleanStr);
  const isDebit = suffix?.[1]?.toUpperCase() === 'DR';
  if (suffix) cleanStr = cleanStr.slice(0, suffix.index);

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

  // A sign can also follow the symbol (`$-5.00`, `€+12,50`); with one on both sides they cancel out
  const isNegativeAfterSymbol = cleanStr.startsWith('-');
  if (isNegativeAfterSymbol || cleanStr.startsWith('+')) {
    cleanStr = cleanStr.slice(1);
  }

  if (suffix && (isNegativeParens || isNegativeSign || isNegativeAfterSymbol)) {
    return null;
  }

  // Determine decimal separator
  // If string has both comma and period, the last one is the decimal separator
  const lastComma = cleanStr.lastIndexOf(',');
  const lastPeriod = cleanStr.lastIndexOf('.');
  const commaCount = cleanStr.split(',').length - 1;
  const periodCount = cleanStr.split('.').length - 1;

  if ((commaCount > 1 && periodCount === 0) || (periodCount > 1 && commaCount === 0)) {
    // A separator repeated with no other mark can only group thousands: 3,250,000 / 1.500.000
    const stripped = stripThousandsSeparator({ value: cleanStr, separator: commaCount > 1 ? ',' : '.' });
    if (stripped === null) return null;
    cleanStr = stripped;
  } else if (lastComma > lastPeriod) {
    // European format: 1.234,56 -> 1234.56
    cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK format: 1,234.56 -> 1234.56
    cleanStr = cleanStr.replace(/,/g, '');
  }

  // Read the leading number and ignore a trailing remainder, the way `parseFloat` does
  const leadingMatch = LEADING_NUMBER.exec(cleanStr);

  if (leadingMatch === null) {
    return null;
  }

  const [leadingNumber, exponent] = leadingMatch;

  // Reject a huge exponent before `Big` expands it into a string of that length
  if (exponent !== undefined && Math.abs(Number(exponent)) > MAX_EXPONENT) {
    return null;
  }

  const magnitude = new Big(leadingNumber);

  if (magnitude.eq(0)) {
    return '0';
  }

  // Apply negative sign
  const isNegative = isDebit || (isNegativeParens || isNegativeSign) !== isNegativeAfterSymbol;
  return (isNegative ? magnitude.neg() : magnitude).toFixed();
}
