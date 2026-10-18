import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllSystemCurrencies } from '@services/system-currencies';

import { getUserId, jsonContent } from './helpers';

export function registerListSupportedCurrencies(server: McpServer) {
  server.registerTool(
    'list_supported_currencies',
    {
      description:
        'List every ISO 4217 currency the app supports, with its code, name and decimals. These are the codes add_user_currencies and change_base_currency accept; a custom currency is not listed here (see list_custom_currencies).',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_supported_currencies', clientId: extra.authInfo?.clientId });

      const currencies = await getAllSystemCurrencies();
      return jsonContent({
        data: currencies.map((currency) => ({
          code: currency.code,
          name: currency.currency,
          decimals: currency.digits,
        })),
      });
    },
  );
}
