import { updateCustomCurrencyBodySchema } from '@common/lib/zod/custom-currency-schemas';
import { currencyCode } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateCustomCurrency } from '@services/currencies/custom-currencies.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  code: currencyCode().describe('Code of the custom currency to update.'),
  ...updateCustomCurrencyBodySchema.shape,
};

export function validateUpdateCustomCurrencyArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { code, ...rest } = args;
  return { code, ...updateCustomCurrencyBodySchema.parse(rest) };
}

export function registerUpdateCustomCurrency(server: McpServer) {
  server.registerTool(
    'update_custom_currency',
    {
      description:
        "Update one of the user's custom currencies. Send only the fields to change: name, decimals, symbol (null clears) and logoUrl (an https URL, null clears). A decimals change is refused while the user has accounts, transactions or other rows in this currency. Returns the updated currency.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_custom_currency', clientId: extra.authInfo?.clientId });

      const currency = await updateCustomCurrency({ userId, ...validateUpdateCustomCurrencyArgs({ args }) });
      return jsonContent({ data: currency });
    },
  );
}
