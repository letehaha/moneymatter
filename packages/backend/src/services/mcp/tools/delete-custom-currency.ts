import { currencyCode } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteCustomCurrency } from '@services/currencies/custom-currencies.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  code: currencyCode().describe('Code of the custom currency to delete.'),
};

export function registerDeleteCustomCurrency(server: McpServer) {
  server.registerTool(
    'delete_custom_currency',
    {
      description:
        "Permanently delete one of the user's custom currencies together with the user's own exchange rates for it. Refused while any account, transaction or other row of the user uses the currency; the error lists where.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_custom_currency', clientId: extra.authInfo?.clientId });

      await deleteCustomCurrency({ userId, code: args.code });
      return jsonContent({ data: { deleted: true, code: args.code } });
    },
  );
}
