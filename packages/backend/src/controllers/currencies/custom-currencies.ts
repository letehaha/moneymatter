import {
  createCustomCurrencyBodySchema,
  updateCustomCurrencyBodySchema,
} from '@common/lib/zod/custom-currency-schemas';
import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as customCurrencies from '@services/currencies/custom-currencies.service';
import { z } from 'zod';

export const listCustomCurrencies = createController(z.object({}), async ({ user }) => {
  const data = await customCurrencies.listCustomCurrencies({ userId: user.id });

  return { data };
});

export const createCustomCurrency = createController(
  z.object({
    body: createCustomCurrencyBodySchema,
  }),
  async ({ user, body }) => {
    const data = await customCurrencies.createCustomCurrency({ userId: user.id, ...body });

    return { data, statusCode: 201 };
  },
);

export const updateCustomCurrency = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: updateCustomCurrencyBodySchema,
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
