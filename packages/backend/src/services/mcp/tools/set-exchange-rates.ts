import { editUserExchangeRates } from '@services/user-exchange-rate';
import { assertEditPairRules, editExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const setExchangeRatesTool = defineTool({
  name: 'set_exchange_rates',
  toolset: 'currencies',
  access: 'write',
  description:
    "Set the user's own exchange rates for currency pairs. Every pair needs its opposite in the same call (EUR to USD and USD to EUR), a pair cannot have the same base and quote, and a pair of two custom currencies is refused (a custom currency is quoted in an ISO currency). A custom currency's quote must be an ISO currency the user holds, one call cannot quote it in two currencies, and a new quote replaces its rates in any other quote. effectiveDate (YYYY-MM-DD) is for pairs with a custom currency: the rate applies from that day until the next one, today when omitted, and the earliest rate also covers every day before it; rates between ISO currencies apply to every day and refuse a date. Account balances and the saved rows of a custom currency are valued again at the new rate. Returns the stored rates and how many account balances were re-measured.",
  input: {
    pairs: z
      .array(editExchangeRatePairSchema)
      .nonempty()
      .describe(
        'Pairs to set: { baseCode, quoteCode, rate > 0, effectiveDate? }. Each pair needs its opposite in the same call.',
      ),
  },
  run: ({ userId, args }) => {
    assertEditPairRules({ pairs: args.pairs });
    return editUserExchangeRates({ userId, pairs: args.pairs });
  },
});
