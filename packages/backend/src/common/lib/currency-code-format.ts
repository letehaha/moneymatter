import { CURRENCY_CODE_PATTERN } from '@bt/shared/types';

// The shape of every currency code the API accepts, ISO 4217 or user-defined, lives in shared types
// (`CURRENCY_CODE_PATTERN`). It says nothing about whether the code exists or is visible to the
// caller; that is `assertCurrencyCodesVisible`.

/** Whether `code`, already uppercased, has the shape of a currency code. */
export const isCurrencyCodeFormat = (code: string): boolean => CURRENCY_CODE_PATTERN.test(code);

/** Uppercases and trims free text (a CSV cell, a statement field) the way the request schemas do. */
export const normalizeCurrencyCode = (code: string): string => code.trim().toUpperCase();
