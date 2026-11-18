import { stripThousandsSeparator } from './parse-decimal-amount';

/**
 * Parse amount string and return numeric value in cents (integer)
 * Supports various formats: 1234.56, 1,234.56, -1234.56, (1234.56)
 *
 * New code should use `parseDecimalAmount`, which rejects ambiguous tokens. This one always
 * guesses: a lone comma is read as the decimal point, so `1,234` returns 123 cents.
 */
export function parseAmount(amountStr: string): number | null {
  if (!amountStr) return null;

  // Banks export U+2212 minus, en/em dashes, and other hyphen look-alikes as the sign
  let cleanStr = amountStr.trim().replace(/^[\u2010-\u2015\u2212\uFE63\uFF0D]/, '-');

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

  // Parse as float
  const parsed = parseFloat(cleanStr);

  if (isNaN(parsed)) {
    return null;
  }

  // Apply negative sign
  const finalValue = isNegativeParens || isNegativeSign ? -parsed : parsed;

  // Convert to cents (integer) - amounts are stored as integers in the system
  // Multiply by 100 and round to avoid floating point issues
  return Math.round(finalValue * 100);
}
