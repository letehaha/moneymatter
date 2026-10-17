import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';

/** Shortest code a currency can have. */
export const CURRENCY_CODE_MIN_LENGTH = 2;

/**
 * Shape of every currency code the API accepts, ISO 4217 or user-defined: uppercase letters and
 * digits. The shape says nothing about whether the code exists or is visible to the caller; that is
 * `assertCurrencyCodesVisible`.
 */
export const CURRENCY_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${CURRENCY_CODE_MIN_LENGTH},${CURRENCY_CODE_MAX_LENGTH}}$`);

/** Whether `code`, already uppercased, has the shape of a currency code. */
export const isCurrencyCodeFormat = (code: string): boolean => CURRENCY_CODE_PATTERN.test(code);

/** Uppercases and trims free text (a CSV cell, a statement field) the way the request schemas do. */
export const normalizeCurrencyCode = (code: string): string => code.trim().toUpperCase();
