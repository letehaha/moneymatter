import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchCoingeckoCoins } from '@services/currencies/rate-sources/coingecko';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  query: z.string().trim().min(1).max(100).describe('Coin name or symbol to look up, such as "bitcoin" or "usdt".'),
};

export function registerSearchCoingeckoCoins(server: McpServer) {
  server.registerTool(
    'search_coingecko_coins',
    {
      description:
        "Search CoinGecko coins by name or symbol, ranked by market cap. Each result has the coinId that a CoinGecko rate source takes (see set_currency_rate_source), plus symbol, name, logoUrl and marketCapRank. Needs the instance's CoinGecko API key; without one the tool says CoinGecko is not available.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'search_coingecko_coins', clientId: extra.authInfo?.clientId });

      const coins = await searchCoingeckoCoins({ query: args.query });
      return jsonContent({ data: coins });
    },
  );
}
