import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as customCurrencies from '@services/currencies/custom-currencies.service';
import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(255);
const decimalsSchema = z.number().int().min(0).max(18);
const symbolSchema = z.string().trim().min(1).max(8);

export const listCustomCurrencies = createController(z.object({}), async ({ user }) => {
  const data = await customCurrencies.listCustomCurrencies({ userId: user.id });

  return { data };
});

export const createCustomCurrency = createController(
  z.object({
    body: z
      .object({
        code: currencyCode(),
        name: nameSchema,
        decimals: decimalsSchema,
        symbol: symbolSchema.nullish(),
      })
      .strict(),
  }),
  async ({ user, body }) => {
    const data = await customCurrencies.createCustomCurrency({ userId: user.id, ...body });

    return { data, statusCode: 201 };
  },
);

export const updateCustomCurrency = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: z
      .object({
        name: nameSchema.optional(),
        decimals: decimalsSchema.optional(),
        symbol: symbolSchema.nullable().optional(),
      })
      .strict(),
  }),
  async ({ user, params, body }) => {
    const data = await customCurrencies.updateCustomCurrency({ userId: user.id, code: params.code, ...body });

    return { data };
  },
);

export const deleteCustomCurrency = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
  }),
  async ({ user, params }) => {
    await customCurrencies.deleteCustomCurrency({ userId: user.id, code: params.code });
  },
);
