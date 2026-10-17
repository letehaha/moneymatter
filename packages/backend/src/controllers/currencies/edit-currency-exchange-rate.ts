import { currencyCode, dateBound } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as userExchangeRates from '@services/user-exchange-rate';
import { z } from 'zod';

const UpdateExchangeRatePairSchema = z
  .object({
    baseCode: currencyCode(),
    quoteCode: currencyCode(),
    rate: z.number().positive(),
    // The day a rate of a custom currency starts to apply; today when omitted. Rates between ISO
    // currencies apply to every day and refuse one.
    effectiveDate: dateBound().optional(),
  })
  .strict();

const schema = z.object({
  body: z
    .object({
      pairs: z
        .array(UpdateExchangeRatePairSchema)
        .nonempty()
        .refine(
          (pairs) => pairs.every((pair) => pair.baseCode !== pair.quoteCode),
          'You cannot edit pair with the same base and quote currency code.',
        )
        .refine(
          (pairs) => pairs.every((pair) => pairs.some((item) => item.baseCode === pair.quoteCode)),
          "When changing base-quote pair rate, you need to also change opposite pair's rate.",
        ),
    })
    .strict(),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const { pairs } = body;

  const data = await userExchangeRates.editUserExchangeRates({
    userId,
    pairs,
  });

  return { data };
});
