import { removeUserExchangeRates } from '@services/user-exchange-rate';
import { removeExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteExchangeRatesTool = defineTool({
  name: 'delete_exchange_rates',
  toolset: 'currencies',
  access: 'delete',
  description:
    "Remove the user's own exchange rates for currency pairs: an ISO pair falls back to the market rate, a custom currency to its other stored rates. Every pair needs its opposite in the same call. For an ISO pair, effectiveDate is left out and every rate of the pair goes. A custom currency's rate is removed one day at a time: every pair with a custom currency needs effectiveDate (YYYY-MM-DD), and only the rate that starts that day goes; its days take the rate before it (the next one, for the first rate). A custom currency has no market rate, so removing its last rate is refused, and so is any removal while its rate source is not manual (see set_currency_rate_source). Saved rows of a custom currency are valued again. Returns how many account balances were re-measured.",
  input: {
    pairs: z
      .array(removeExchangeRatePairSchema.pick({ baseCode: true, quoteCode: true, effectiveDate: true }).strict())
      .nonempty()
      .describe(
        'Pairs to remove: { baseCode, quoteCode, effectiveDate? }. Each pair needs its opposite in the same call; a pair with a custom currency needs effectiveDate.',
      ),
  },
  run: ({ userId, args }) => removeUserExchangeRates({ userId, pairs: args.pairs }),
});
