import {
  CUSTOM_CURRENCY_DECIMALS_MAX,
  CUSTOM_CURRENCY_DECIMALS_MIN,
  CUSTOM_CURRENCY_NAME_MAX_LENGTH,
  CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH,
} from '@bt/shared/types';
import {
  logoFieldsShape,
  logoImageSchema,
  refineLogoFields,
  refineLogoFieldsOnCreate,
} from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

import { currencyCode } from './custom-types';

/**
 * Request bodies of the custom-currency routes. The REST controller and the MCP tools both
 * parse with these, so the two paths accept the same inputs. The MCP tools expose the `*Fields`
 * shapes, which carry no `logoImage` upload.
 */

const nameSchema = z.string().trim().min(1).max(CUSTOM_CURRENCY_NAME_MAX_LENGTH);
const decimalsSchema = z.number().int().min(CUSTOM_CURRENCY_DECIMALS_MIN).max(CUSTOM_CURRENCY_DECIMALS_MAX);
const symbolSchema = z.string().trim().min(1).max(CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH);

const describedLogoFields = {
  logoDomain: logoFieldsShape.logoDomain.describe(
    'Brand domain to take the logo from (e.g. "bitcoin.org", no protocol or slashes), or null to clear. Not together with logoInitials or logoIcon.',
  ),
  logoInitials: logoFieldsShape.logoInitials.describe(
    'One or two characters shown as a monogram, or null to clear. Not together with logoDomain or logoIcon.',
  ),
  logoColor: logoFieldsShape.logoColor.describe(
    'Monogram or icon background as #rrggbb, or null for the default tint; needs logoInitials or logoIcon.',
  ),
  logoIcon: logoFieldsShape.logoIcon.describe(
    'Icon key shown as the logo (e.g. "food-24-regular"), or null to clear. Not together with logoDomain or logoInitials.',
  ),
};

export const customCurrencyDefinitionSchema = z
  .object({
    code: currencyCode(),
    name: nameSchema,
    decimals: decimalsSchema,
    symbol: symbolSchema.nullish(),
  })
  .strict();

export const createCustomCurrencyBodyFields = {
  ...customCurrencyDefinitionSchema.shape,
  rate: z
    .object({
      value: z.number().positive(),
      quoteCode: currencyCode().optional(),
    })
    .strict(),
  ...describedLogoFields,
};

export const createCustomCurrencyBodySchema = z
  .object({ ...createCustomCurrencyBodyFields, logoImage: logoImageSchema })
  .strict()
  .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx }));

export const updateCustomCurrencyBodyFields = {
  name: nameSchema.optional(),
  decimals: decimalsSchema.optional(),
  symbol: symbolSchema.nullable().optional(),
  ...describedLogoFields,
};

export const updateCustomCurrencyBodySchema = z
  .object({ ...updateCustomCurrencyBodyFields, logoImage: logoImageSchema })
  .strict()
  .superRefine((data, ctx) => refineLogoFields({ data, ctx }));
