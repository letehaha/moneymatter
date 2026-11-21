import { removeUserExchangeRates } from '@services/user-exchange-rate';
import {
  assertRemovePairRules,
  removeExchangeRatePairSchema,
} from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteExchangeRatesTool = defineTool({
  name: 'delete_exchange_rates',
  toolset: 'currencies',
  access: 'delete',
  description:
    "Remove the user's own exchange rates for currency pairs: an ISO pair falls back to the market rate, a custom currency to its other stored rates. Every pair needs its opposite in the same call. Without effectiveDate every rate of the pair goes; with one (YYYY-MM-DD) only the rate that starts that day, and its days take the rate before it (the next one, for the first rate). A custom currency has no market rate, so removing its last rate is refused. Saved rows of a custom currency are valued again. Returns how many account balances were re-measured.",
  input: {
    pairs: z
      .array(removeExchangeRatePairSchema.pick({ baseCode: true, quoteCode: true, effectiveDate: true }).strict())
      .nonempty()
      .describe(
        'Pairs to remove: { baseCode, quoteCode, effectiveDate? }. Each pair needs its opposite in the same call.',
      ),
  },
  run: ({ userId, args }) => {
    assertRemovePairRules({ pairs: args.pairs });
    return removeUserExchangeRates({ userId, pairs: args.pairs });
  },
});
