import { createController } from '@controllers/helpers/controller-factory';
import * as userExchangeRates from '@services/user-exchange-rate';
import { z } from 'zod';

import { setExchangeRatePairsSchema } from './exchange-rate-pairs.schema';

const schema = z.object({
  body: z
    .object({
      pairs: setExchangeRatePairsSchema,
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
