import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listCustomCurrencies } from '@services/currencies/custom-currencies.service';

import { getUserId, jsonContent } from './helpers';

export function registerListCustomCurrencies(server: McpServer) {
  server.registerTool(
    'list_custom_currencies',
    {
      description:
        "List the user's custom currencies (their own units such as points or crypto tokens, not ISO codes). Returns code, name, symbol, decimals and logoUrl for each.",
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_custom_currencies', clientId: extra.authInfo?.clientId });

      const currencies = await listCustomCurrencies({ userId });
      return jsonContent({ data: currencies });
    },
  );
}
