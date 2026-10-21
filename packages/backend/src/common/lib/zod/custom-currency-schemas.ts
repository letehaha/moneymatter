import {
  CUSTOM_CURRENCY_DECIMALS_MAX,
  CUSTOM_CURRENCY_DECIMALS_MIN,
  CUSTOM_CURRENCY_NAME_MAX_LENGTH,
  CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH,
} from '@bt/shared/types';
import { z } from 'zod';

import { currencyCode, currencyLogoUrl } from './custom-types';

/**
 * Request bodies of the custom-currency routes. The REST controller and the MCP tools both
 * parse with these, so the two paths accept the same inputs.
 */

const nameSchema = z.string().trim().min(1).max(CUSTOM_CURRENCY_NAME_MAX_LENGTH);
const decimalsSchema = z.number().int().min(CUSTOM_CURRENCY_DECIMALS_MIN).max(CUSTOM_CURRENCY_DECIMALS_MAX);
const symbolSchema = z.string().trim().min(1).max(CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH);

export const createCustomCurrencyBodySchema = z
  .object({
    code: currencyCode(),
    name: nameSchema,
    decimals: decimalsSchema,
    symbol: symbolSchema.nullish(),
  })
  .strict();

export const updateCustomCurrencyBodySchema = z
  .object({
    name: nameSchema.optional(),
    decimals: decimalsSchema.optional(),
    symbol: symbolSchema.nullable().optional(),
    logoUrl: currencyLogoUrl().optional(),
  })
  .strict();
