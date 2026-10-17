import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeUserExchangeRates } from '@services/user-exchange-rate';
import { removeExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  pairs: z
    .array(removeExchangeRatePairSchema.pick({ baseCode: true, quoteCode: true, effectiveDate: true }))
    .nonempty()
    .describe(
      'Pairs to remove: { baseCode, quoteCode, effectiveDate? }. Each pair needs its opposite in the same call.',
    ),
};

export function registerDeleteExchangeRates(server: McpServer) {
  server.registerTool(
    'delete_exchange_rates',
    {
      description:
        "Remove the user's own exchange rates for currency pairs, so the pair falls back to the market rate (an ISO pair) or to an earlier rate (a custom currency). Every pair needs its opposite in the same call. Without effectiveDate every rate of the pair goes; with one (YYYY-MM-DD) only the rate that starts that day. Saved rows of a custom currency are valued again. Returns how many account balances were re-measured. Requires finance:delete.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_exchange_rates', clientId: extra.authInfo?.clientId });

      const result = await removeUserExchangeRates({ userId, pairs: args.pairs });
      return jsonContent({ data: result });
    },
  );
}
