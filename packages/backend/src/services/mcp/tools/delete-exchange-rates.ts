import { currencyCode } from '@common/lib/zod/custom-types';
import { ValidationError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeUserExchangeRates } from '@services/user-exchange-rate';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  pairs: z
    .array(z.object({ baseCode: currencyCode(), quoteCode: currencyCode() }).strict())
    .nonempty()
    .describe('Pairs to remove: { baseCode, quoteCode }. Each pair needs its opposite in the same call.'),
};

export function registerDeleteExchangeRates(server: McpServer) {
  server.registerTool(
    'delete_exchange_rates',
    {
      description:
        "Remove the user's own exchange rates for currency pairs, so the pair falls back to the market rate. Every pair needs its opposite in the same call. Returns how many account balances were re-measured. Requires finance:delete scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_exchange_rates', clientId: extra.authInfo?.clientId });

      const { pairs } = args;

      if (!pairs.every((pair) => pairs.some((item) => item.baseCode === pair.quoteCode))) {
        throw new ValidationError({
          message: "When removing base-qoute pair rate, you need to also remove opposite pair's rate.",
        });
      }

      const result = await removeUserExchangeRates({ userId, pairs });
      return jsonContent({ data: result });
    },
  );
}
