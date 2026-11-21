import { searchCoingeckoCoins } from '@services/currencies/rate-sources/coingecko';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const searchCoingeckoCoinsTool = defineTool({
  name: 'search_coingecko_coins',
  toolset: 'currencies',
  access: 'read',
  description:
    "Search CoinGecko coins by name or symbol, ranked by market cap. Each result has the coinId that a CoinGecko rate source takes (see set_currency_rate_source), plus symbol, name, logoUrl and marketCapRank. Needs the instance's CoinGecko API key; without one the tool says CoinGecko is not available.",
  input: {
    query: z.string().trim().min(1).max(100).describe('Coin name or symbol to look up, such as "bitcoin" or "usdt".'),
  },
  run: ({ args }) => searchCoingeckoCoins({ query: args.query }),
});
