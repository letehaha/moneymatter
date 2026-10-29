import { currencyCode } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/**
 * The bodies of the user-currency writes (`POST /user/currencies`, `PUT /user/currency`,
 * `DELETE /user/currency`), shared by the REST controllers and the MCP currency tools so the two
 * paths accept exactly the same input.
 */

export const addUserCurrenciesBodySchema = z
  .object({
    currencies: z
      .array(
        z
          .object({
            currencyCode: currencyCode(),
            exchangeRate: z.number().positive().optional(),
            liveRateUpdate: z.boolean().optional(),
          })
          .strict(),
      )
      .nonempty(),
  })
  .strict();

export const editUserCurrencyBodySchema = z.object({
  currencyCode: currencyCode(),
  exchangeRate: z.number().optional(),
  liveRateUpdate: z.boolean().optional(),
});

export const deleteUserCurrencyBodySchema = z.object({
  currencyCode: currencyCode(),
});
