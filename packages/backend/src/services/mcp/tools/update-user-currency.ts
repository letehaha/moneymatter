import { editUserCurrencyBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { editUserCurrency } from '@services/user.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = editUserCurrencyBodySchema.shape;

export function registerUpdateUserCurrency(server: McpServer) {
  server.registerTool(
    'update_user_currency',
    {
      description:
        "Change how one held currency is valued: exchangeRate (the flat rate to the base currency) and liveRateUpdate (true follows the market rate, false keeps the manual one). Switching liveRateUpdate re-values the stored balances and the custom currencies that depend on this one, which can take a moment. The user must already hold the currency (see get_user_currencies). A custom currency's source and dated rates are changed with set_currency_rate_source and set_exchange_rates. Returns the updated currency.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_user_currency', clientId: extra.authInfo?.clientId });

      const result = await editUserCurrency({
        userId,
        currencyCode: args.currencyCode,
        exchangeRate: args.exchangeRate,
        liveRateUpdate: args.liveRateUpdate,
      });
      return jsonContent({ data: result });
    },
  );
}
