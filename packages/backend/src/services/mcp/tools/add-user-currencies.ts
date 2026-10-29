import { addUserCurrenciesBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addUserCurrencies } from '@services/currencies/add-user-currency';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = addUserCurrenciesBodySchema.shape;

export function registerAddUserCurrencies(server: McpServer) {
  server.registerTool(
    'add_user_currencies',
    {
      description:
        'Add currencies to the ones the user holds, so accounts and transactions can use them. Each entry is { currencyCode, exchangeRate? (> 0, the flat rate to the base currency), liveRateUpdate? (true follows the market, false keeps the manual rate) }. A code must be an ISO currency (see list_supported_currencies). Codes the user already holds are skipped and listed in alreadyExistingCodes.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'add_user_currencies', clientId: extra.authInfo?.clientId });

      const result = await addUserCurrencies(args.currencies.map((currency) => ({ userId, ...currency })));
      return jsonContent({ data: result });
    },
  );
}
