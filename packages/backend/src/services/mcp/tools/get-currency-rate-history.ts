import { currencyCode } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listCurrencyRateHistory } from '@services/currencies/rate-sources/rate-history.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  code: currencyCode().describe(
    'Code of one of the user\'s custom currencies, such as "PTS". ISO currencies have no history.',
  ),
  limit: z.number().int().min(1).max(100).optional().describe('Rates per page, 1 to 100. Defaults to 30.'),
  offset: z.number().int().nonnegative().optional().describe('Rates to skip, for the next page. Defaults to 0.'),
};

export function registerGetCurrencyRateHistory(server: McpServer) {
  server.registerTool(
    'get_currency_rate_history',
    {
      description:
        "List the stored rates of one of the user's custom currencies, latest first: quote currency, rate, effective date, source (manual, peg, coingecko, http), when it was written, and which row is in force now. totalCount comes with the first page only. Refused for an ISO currency.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_currency_rate_history', clientId: extra.authInfo?.clientId });

      const { code, limit = 30, offset = 0 } = args;
      const history = await listCurrencyRateHistory({ userId, code, limit, offset });
      return jsonContent({ data: history });
    },
  );
}
