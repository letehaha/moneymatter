import {
  exchangeRatePairSchema,
  removeExchangeRatePairsSchema,
} from '@controllers/currencies/exchange-rate-pairs.schema';
import { removeUserExchangeRates } from '@services/user-exchange-rate';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteExchangeRatesTool = defineTool({
  name: 'delete_exchange_rates',
  toolset: 'currencies',
  access: 'delete',
  description:
    "Remove the user's own exchange rates for currency pairs, so the pair falls back to the market rate. Every pair needs its opposite in the same call. Returns how many account balances were re-measured.",
  input: {
    pairs: z
      .array(exchangeRatePairSchema)
      .nonempty()
      .describe('Pairs to remove: { baseCode, quoteCode }. Each pair needs its opposite in the same call.'),
  },
  validate: ({ args }) => ({ pairs: removeExchangeRatePairsSchema.parse(args.pairs) }),
  run: ({ userId, args: { pairs } }) => removeUserExchangeRates({ userId, pairs }),
});
