import { currencyCode } from '@common/lib/zod/custom-types';
import { RATE_SOURCE_SAVE_LIMIT } from '@services/common/user-rate-limits';
import {
  coingeckoRateSourceConfigSchema,
  coinLogoUrlSchema,
  httpRateSourceConfigSchema,
  pegRateSourceConfigSchema,
  updateRateSourceBodySchema,
} from '@services/currencies/rate-sources';
import { saveCurrencyRateSource } from '@services/currencies/rate-sources/save-rate-source.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { enforceUserRateLimit } from './helpers';

// The REST body is a union keyed by `rateSource`, which a tool's plain input shape cannot hold, so the
// shape lists the fields and `run` parses them with the REST schema.
export const setCurrencyRateSourceTool = defineTool({
  name: 'set_currency_rate_source',
  toolset: 'currencies',
  access: 'write',
  description: [
    'Set how a currency gets its rates. Sources:',
    '- provider: the market provider, for ISO currencies only. No config.',
    '- manual: the user types the rates (set_exchange_rates). No config. The default for a custom currency.',
    '- peg: a custom currency that tracks an ISO currency. config: { pegCurrency, factor } (pegCurrency is an ISO code, factor > 0).',
    '- coingecko: a custom currency priced by a CoinGecko coin, custom currencies only. config: { coinId, quoteCurrency? } (find the coinId with search_coingecko_coins; quoteCurrency is an ISO code). logoUrl is optional: the coin image to store as the currency logo, null clears the logo image. Saving pulls the last year of daily prices and is refused when no price comes back.',
    "- http: a custom currency priced by the user's own endpoint. config: { urlTemplate, jsonPath, quoteCurrency?, headers? }. The URL may hold {date}, {code} and {quote}; jsonPath is where the price sits, such as data.price; quoteCurrency is an ISO code. Header values are stored encrypted and never returned; omit headers to keep the saved ones, send {} to remove them. Saving fetches today's price and is refused when none comes back; try it first with test_currency_rate_source.",
    "A change that would leave a custom currency with no rate is refused. A change values the currency's saved rows again. Rate limited to 20 saves per minute. Returns the saved source (header names only).",
  ].join('\n'),
  input: {
    code: currencyCode().describe('Code of the currency to set the rate source of.'),
    rateSource: z
      .enum(['provider', 'manual', 'peg', 'coingecko', 'http'])
      .describe('How the currency gets its rates. Which config it takes is in the tool description.'),
    config: z
      .union([pegRateSourceConfigSchema, coingeckoRateSourceConfigSchema, httpRateSourceConfigSchema])
      .optional()
      .describe('The settings of the source; leave it out for provider and manual.'),
    logoUrl: coinLogoUrlSchema
      .optional()
      .describe(
        'coingecko only: the logoUrl of the coin from search_coingecko_coins, stored as the currency logo; omit to keep the current one, null clears it. A logo that cannot be downloaded keeps the current one.',
      ),
  },
  run: async ({ userId, args }) => {
    await enforceUserRateLimit({ userId, limit: RATE_SOURCE_SAVE_LIMIT });

    const { code, ...fields } = args;
    const body = updateRateSourceBodySchema.parse(
      Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    );
    return saveCurrencyRateSource({ userId, code, body });
  },
});
