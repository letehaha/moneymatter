import { createController } from '@controllers/helpers/controller-factory';
import * as userExchangeRates from '@services/user-exchange-rate';
import { editExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

// The pair rules (no pair against itself, every pair with its opposite) are enforced by the service.
const schema = z.object({
  body: z.object({ pairs: z.array(editExchangeRatePairSchema).nonempty() }).strict(),
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
