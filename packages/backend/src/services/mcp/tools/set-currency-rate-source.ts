import { currencyCode, currencyLogoUrl } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RATE_SOURCE_SAVE_LIMIT } from '@services/common/user-rate-limits';
import {
  coingeckoRateSourceConfigSchema,
  httpRateSourceConfigSchema,
  pegRateSourceConfigSchema,
  updateRateSourceBodySchema,
} from '@services/currencies/rate-sources';
import { saveCurrencyRateSource } from '@services/currencies/rate-sources/save-rate-source.service';
import { z } from 'zod';

import {
  assertBaseCurrencyUnlocked,
  enforceUserRateLimit,
  getUserId,
  jsonContent,
  requireScope,
  type ToolArgs,
} from './helpers';

// The REST body is a union keyed by `rateSource`, which a tool's plain input shape cannot hold, so the
// shape lists the fields and the handler runs the REST schema over them.
const inputSchema = {
  code: currencyCode().describe('Code of the currency to set the rate source of.'),
  rateSource: z
    .enum(['provider', 'manual', 'peg', 'coingecko', 'http'])
    .describe('How the currency gets its rates. Which config it takes is in the tool description.'),
  config: z
    .union([pegRateSourceConfigSchema, coingeckoRateSourceConfigSchema, httpRateSourceConfigSchema])
    .optional()
    .describe('The settings of the source; leave it out for provider and manual.'),
  logoUrl: currencyLogoUrl()
    .optional()
    .describe('coingecko only: the coin logo to store (https URL); omit to keep the current one, null clears it.'),
};

export function validateSetCurrencyRateSourceArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { code, ...fields } = args;
  const body = updateRateSourceBodySchema.parse(
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  );
  return { code, body };
}

export function registerSetCurrencyRateSource(server: McpServer) {
  server.registerTool(
    'set_currency_rate_source',
    {
      description: [
        'Set how a currency gets its rates. Sources:',
        '- provider: the market provider, for ISO currencies only. No config.',
        '- manual: the user types the rates (set_exchange_rates). No config. The default for a custom currency.',
        '- peg: a custom currency that tracks another currency. config: { pegCurrency, factor } (factor > 0).',
        '- coingecko: a custom currency priced by a CoinGecko coin, custom currencies only. config: { coinId, quoteCurrency? } (find the coinId with search_coingecko_coins); logoUrl is optional. Saving pulls the last year of daily prices.',
        "- http: a custom currency priced by the user's own endpoint. config: { urlTemplate, jsonPath, quoteCurrency?, headers? }. The URL may hold {date}, {code} and {quote}; jsonPath is where the price sits, such as data.price. Header values are stored encrypted and never returned; omit headers to keep the saved ones, send {} to remove them. Try it first with test_currency_rate_source.",
        "A change values the currency's saved rows again. Rate limited to 20 saves per minute. Returns the saved source (header names only).",
      ].join('\n'),
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      await enforceUserRateLimit({ userId, limit: RATE_SOURCE_SAVE_LIMIT });
      trackMcpToolUsed({ userId, tool: 'set_currency_rate_source', clientId: extra.authInfo?.clientId });

      const { code, body } = validateSetCurrencyRateSourceArgs({ args });
      const saved = await saveCurrencyRateSource({ userId, code, body });
      return jsonContent({ data: saved });
    },
  );
}
