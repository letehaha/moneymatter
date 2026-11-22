import { editUserExchangeRates } from '@services/user-exchange-rate';
import { editExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const setExchangeRatesTool = defineTool({
  name: 'set_exchange_rates',
  toolset: 'currencies',
  access: 'write',
  description:
    "Set the user's own exchange rates for currency pairs. Every pair needs its opposite in the same call (EUR to USD and USD to EUR), a pair cannot have the same base and quote, and a pair of two custom currencies is refused (a custom currency is quoted in an ISO currency). A custom currency holds one rate per day, quoted in any ISO currency the user holds: only the custom-to-ISO rate is stored (its opposite is checked, then derived as its inverse), a write replaces that day's rate in whatever quote it had and leaves every other day alone, and one call cannot quote a custom currency in two currencies for the same day. It is refused while the custom currency's rate source is not manual (see set_currency_rate_source). effectiveDate (YYYY-MM-DD) is for pairs with a custom currency: the rate applies from that day until the next one, today when omitted, and the earliest rate also covers every day before it; rates between ISO currencies apply to every day and refuse a date. Account balances and the saved rows of a custom currency are valued again at the new rate. Returns the stored rates and how many account balances were re-measured.",
  input: {
    pairs: z
      .array(editExchangeRatePairSchema)
      .nonempty()
      .describe(
        'Pairs to set: { baseCode, quoteCode, rate > 0, effectiveDate? }. Each pair needs its opposite in the same call.',
      ),
  },
  run: ({ userId, args }) => editUserExchangeRates({ userId, pairs: args.pairs }),
});
