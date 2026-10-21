import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { editUserExchangeRates } from '@services/user-exchange-rate';
import { editExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  pairs: z
    .array(editExchangeRatePairSchema)
    .nonempty()
    .describe(
      'Pairs to set: { baseCode, quoteCode, rate > 0, effectiveDate? }. Each pair needs its opposite in the same call.',
    ),
};

export function registerSetExchangeRates(server: McpServer) {
  server.registerTool(
    'set_exchange_rates',
    {
      description:
        "Set the user's own exchange rates for currency pairs. Every pair needs its opposite in the same call (USDT to USD and USD to USDT), and a pair cannot have the same base and quote. effectiveDate (YYYY-MM-DD) is for pairs with a custom currency: the rate applies from that day until the next one, and today when omitted; rates between ISO currencies apply to every day and refuse a date. Saved rows of a custom currency are valued again at the new rate. Returns the stored rates and how many account balances were re-measured.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_exchange_rates', clientId: extra.authInfo?.clientId });

      const result = await editUserExchangeRates({ userId, pairs: args.pairs });
      return jsonContent({ data: result });
    },
  );
}
