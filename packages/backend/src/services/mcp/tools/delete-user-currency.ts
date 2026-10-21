import { deleteUserCurrencyBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteUserCurrency } from '@services/user.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = deleteUserCurrencyBodySchema.shape;

export function registerDeleteUserCurrency(server: McpServer) {
  server.registerTool(
    'delete_user_currency',
    {
      description:
        'Stop holding a currency. Refused for the base currency and for a currency that accounts or holdings still use. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_user_currency', clientId: extra.authInfo?.clientId });

      await deleteUserCurrency({ userId, currencyCode: args.currencyCode });
      return jsonContent({ data: { deleted: true, currencyCode: args.currencyCode } });
    },
  );
}
