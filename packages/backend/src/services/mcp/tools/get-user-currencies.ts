import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUserExchangeRates } from '@services/user-exchange-rate';
import { getUserBaseCurrency, getUserCurrencies } from '@services/user.service';

import { getUserId, jsonContent } from './helpers';

export function registerGetUserCurrencies(server: McpServer) {
  server.registerTool(
    'get_user_currencies',
    {
      description:
        "Get the currencies the user holds: baseCurrency (the reporting currency, null before one is set), currencies (every held currency with its settings: liveRateUpdate and exchangeRate) and exchangeRates (today's rate of each currency to the base). Use list_supported_currencies for the codes that can still be added.",
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_user_currencies', clientId: extra.authInfo?.clientId });

      const [currencies, baseCurrency, exchangeRates] = await Promise.all([
        getUserCurrencies({ userId }),
        getUserBaseCurrency({ userId }),
        getUserExchangeRates({ userId }),
      ]);
      return jsonContent({ data: { baseCurrency: baseCurrency ?? null, currencies, exchangeRates } });
    },
  );
}
