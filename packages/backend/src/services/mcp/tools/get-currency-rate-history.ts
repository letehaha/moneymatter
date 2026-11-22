import { currencyCode } from '@common/lib/zod/custom-types';
import { listCurrencyRateHistory } from '@services/currencies/rate-sources/rate-history.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getCurrencyRateHistoryTool = defineTool({
  name: 'get_currency_rate_history',
  toolset: 'currencies',
  access: 'read',
  description:
    "List the stored rates of one of the user's custom currencies, latest first: quote currency, rate, effective date, source (initial, manual, coingecko, http), when it was written, and which row is in force now. initial is the rate the currency was created with. The earliest rate also covers every day before it. totalCount comes with the first page only. Refused for an ISO currency.",
  input: {
    code: currencyCode().describe(
      'Code of one of the user\'s custom currencies, such as "PTS". ISO currencies have no history.',
    ),
    limit: z.number().int().min(1).max(100).optional().describe('Rates per page, 1 to 100. Defaults to 30.'),
    offset: z.number().int().nonnegative().optional().describe('Rates to skip, for the next page. Defaults to 0.'),
  },
  run: ({ userId, args }) => {
    const { code, limit = 30, offset = 0 } = args;
    return listCurrencyRateHistory({ userId, code, limit, offset });
  },
});
