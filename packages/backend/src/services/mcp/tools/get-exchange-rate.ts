import { currencyCode, dateBound } from '@common/lib/zod/custom-types';
import { ExchangeRateUnavailableError } from '@js/errors';
import { getExchangeRatesForDate } from '@services/exchange-rates';
import { getExchangeRate } from '@services/user-exchange-rate';

import { defineTool } from '../define-tool';

export const getExchangeRateTool = defineTool({
  name: 'get_exchange_rate',
  toolset: 'currencies',
  access: 'read',
  description:
    'Read an exchange rate for a day. With "from" and "to" it returns the rate of that pair as the app values it (the user\'s own rate when they set one, the market rate otherwise): 1 "from" is worth "rate" "to". With neither it returns the global market rates stored for the date, each as baseCode, quoteCode and rate. Giving only one of the two codes is refused. Fails when no rate exists for the pair on or before the date.',
  input: {
    date: dateBound().describe('Day to read the rate for, YYYY-MM-DD.'),
    from: currencyCode().optional().describe('Base code of the pair, such as "USD". Give it together with "to".'),
    to: currencyCode().optional().describe('Quote code of the pair, such as "EUR". Give it together with "from".'),
  },
  run: async ({ userId, args }) => {
    const { date, from, to } = args;
    if ((from === undefined) !== (to === undefined)) {
      throw new Error('Give both "from" and "to" for one pair, or neither for the global rates of the date.');
    }

    if (from === undefined || to === undefined) {
      const rates = await getExchangeRatesForDate({ date });
      return {
        date,
        rates: (rates ?? []).map((rate) => ({
          baseCode: rate.baseCode,
          quoteCode: rate.quoteCode,
          rate: rate.rate,
        })),
      };
    }

    try {
      return await getExchangeRate({
        userId,
        baseCode: from,
        quoteCode: to,
        date: new Date(date),
        requireUserConnection: false,
      });
    } catch (error) {
      // A pair with no published rate is a routine miss: say so, instead of the generic failure.
      if (error instanceof ExchangeRateUnavailableError) {
        throw new Error(`No exchange rate is available for ${from}/${to} on or before ${date}.`, { cause: error });
      }
      throw error;
    }
  },
});
