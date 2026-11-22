import { CURRENCY_RATE_SOURCES, type CoingeckoRateSourceConfig } from '@bt/shared/types';
import { currencyCode, isoCurrencyCode } from '@common/lib/zod/custom-types';
import { getCurrency } from '@models/users-currencies.model';
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

// The REST schema defaults an omitted quote to USD; here it stays undefined so `run` can keep the saved one.
const coingeckoInputSchema = coingeckoRateSourceConfigSchema.extend({ quoteCurrency: isoCurrencyCode().optional() });

// The REST body is a union keyed by `rateSource`, which a tool's plain input shape cannot hold, so the
// shape lists the fields and `run` parses them with the REST schema.
export const setCurrencyRateSourceTool = defineTool({
  name: 'set_currency_rate_source',
  toolset: 'currencies',
  access: 'write',
  description: [
    "Set how one of the user's custom currencies gets its rates. ISO currencies are refused: their live rates are switched with update_user_currency. Sources:",
    '- manual: the user types the rates (set_exchange_rates, delete_exchange_rates). No config. The default. Every other source refuses manual rate edits and removals.',
    '- peg: tracks an ISO currency. config: { pegCurrency, factor } (pegCurrency is an ISO code, factor > 0).',
    '- coingecko: priced by a CoinGecko coin. config: { coinId, quoteCurrency? } (find the coinId with search_coingecko_coins; quoteCurrency is an ISO code; left out, it keeps the saved quote when the coin is the one already saved, and is USD otherwise). logoUrl is optional: the coin image to store as the currency logo, null clears the logo image. Saving pulls the last year of daily prices and is refused when no price comes back.',
    "- http: priced by the user's own endpoint. config: { urlTemplate, jsonPath, quoteCurrency?, headers? }. The URL may hold {date}, {code} and {quote}; jsonPath is where the price sits, such as data.price; quoteCurrency is an ISO code (USD when left out). Header values are stored encrypted and never returned; omit headers to keep the saved ones, send {} to remove them. Saving fetches today's price and is refused when none comes back; try it first with test_currency_rate_source.",
    "A synced source (coingecko, http) replaces the creation rate and any synced rate on the days it returns, and never a manual rate. Stored rates are kept on every save, except that changing the coin of a currency already on coingecko drops the old coin's prices. A change that would leave the currency with no rate is refused. A change values the currency's saved rows again. Rate limited to 20 saves per minute. Returns the saved source (header names only).",
  ].join('\n'),
  input: {
    code: currencyCode().describe('Code of the custom currency to set the rate source of.'),
    rateSource: z
      .enum(CURRENCY_RATE_SOURCES)
      .describe('How the currency gets its rates. Which config it takes is in the tool description.'),
    config: z
      .union([pegRateSourceConfigSchema, coingeckoInputSchema, httpRateSourceConfigSchema])
      .optional()
      .describe('The settings of the source; leave it out for manual.'),
    logoUrl: coinLogoUrlSchema
      .optional()
      .describe(
        'coingecko only: the logoUrl of the coin from search_coingecko_coins, stored as the currency logo; omit to keep the current one, null clears it. A logo that cannot be downloaded keeps the current one.',
      ),
  },
  run: async ({ userId, args }) => {
    await enforceUserRateLimit({ userId, limit: RATE_SOURCE_SAVE_LIMIT });

    const { code, ...fields } = args;
    if (
      fields.rateSource === 'coingecko' &&
      fields.config &&
      'coinId' in fields.config &&
      !fields.config.quoteCurrency
    ) {
      const saved = await getCurrency({ userId, currencyCode: code });
      const savedConfig =
        saved?.rateSource === 'coingecko' ? (saved.rateSourceConfig as CoingeckoRateSourceConfig) : null;
      if (savedConfig?.coinId === fields.config.coinId) {
        fields.config = { ...fields.config, quoteCurrency: savedConfig.quoteCurrency };
      }
    }

    const body = updateRateSourceBodySchema.parse(
      Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    );
    return saveCurrencyRateSource({ userId, code, body });
  },
});
