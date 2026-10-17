import { createCustomCurrencyBodySchema } from '@common/lib/zod/custom-currency-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCustomCurrency } from '@services/currencies/custom-currencies.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = createCustomCurrencyBodySchema.shape;

export function registerCreateCustomCurrency(server: McpServer) {
  server.registerTool(
    'create_custom_currency',
    {
      description:
        'Define a custom currency for the user (points, crypto tokens, a local unit). The code is 2 to 16 letters or digits and must not be an ISO code or one the user already defined; decimals is how many fractional digits amounts keep. Custom currencies are per user, and they need a rate source or manual rates before their base-currency values are known. Returns the created currency.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_custom_currency', clientId: extra.authInfo?.clientId });

      const body = createCustomCurrencyBodySchema.parse(args);
      const currency = await createCustomCurrency({ userId, ...body });
      return jsonContent({ data: currency });
    },
  );
}
