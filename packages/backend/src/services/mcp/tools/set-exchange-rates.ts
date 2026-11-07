import {
  exchangeRatePairWithRateSchema,
  setExchangeRatePairsSchema,
} from '@controllers/currencies/exchange-rate-pairs.schema';
import { editUserExchangeRates } from '@services/user-exchange-rate';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const setExchangeRatesTool = defineTool({
  name: 'set_exchange_rates',
  toolset: 'currencies',
  access: 'write',
  description:
    "Set the user's own exchange rates for currency pairs. Every pair needs its opposite in the same call (EUR to USD and USD to EUR), and a pair cannot have the same base and quote. Account balances are re-measured at the new rate. Returns the stored rates and how many account balances were re-measured.",
  input: {
    pairs: z
      .array(exchangeRatePairWithRateSchema)
      .nonempty()
      .describe('Pairs to set: { baseCode, quoteCode, rate > 0 }. Each pair needs its opposite in the same call.'),
  },
  validate: ({ args }) => ({ pairs: setExchangeRatePairsSchema.parse(args.pairs) }),
  run: ({ userId, args: { pairs } }) => editUserExchangeRates({ userId, pairs }),
});
