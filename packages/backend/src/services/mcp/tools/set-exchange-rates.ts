import { currencyCode } from '@common/lib/zod/custom-types';
import { ValidationError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { editUserExchangeRates } from '@services/user-exchange-rate';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  pairs: z
    .array(
      z
        .object({
          baseCode: currencyCode(),
          quoteCode: currencyCode(),
          rate: z.number().positive(),
        })
        .strict(),
    )
    .nonempty()
    .describe('Pairs to set: { baseCode, quoteCode, rate > 0 }. Each pair needs its opposite in the same call.'),
};

export function registerSetExchangeRates(server: McpServer) {
  server.registerTool(
    'set_exchange_rates',
    {
      description:
        "Set the user's own exchange rates for currency pairs. Every pair needs its opposite in the same call (EUR to USD and USD to EUR), and a pair cannot have the same base and quote. Account balances are re-measured at the new rate. Returns the stored rates and how many account balances were re-measured. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_exchange_rates', clientId: extra.authInfo?.clientId });

      const { pairs } = args;

      if (pairs.some((pair) => pair.baseCode === pair.quoteCode)) {
        throw new ValidationError({
          message: 'You cannot edit pair with the same base and quote currency code.',
        });
      }
      if (!pairs.every((pair) => pairs.some((item) => item.baseCode === pair.quoteCode))) {
        throw new ValidationError({
          message: "When changing base-quote pair rate, you need to also change opposite pair's rate.",
        });
      }

      const result = await editUserExchangeRates({ userId, pairs });
      return jsonContent({ data: result });
    },
  );
}
