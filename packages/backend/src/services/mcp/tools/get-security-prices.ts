import { recordId } from '@common/lib/zod/custom-types';
import { securityPricesQuerySchema } from '@controllers/investments/prices/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPrices } from '@services/investments/securities-price/get-prices.service';

import { getUserId, jsonContent } from './helpers';
import { presentSecurityPrice } from './holding-output';

const shape = securityPricesQuerySchema.shape;

const inputSchema = {
  securityId: recordId().describe('Security ID (from get_portfolio_holdings or create_holding)'),
  from: shape.from.describe('Start of the range, ISO 8601 UTC (e.g. "2026-01-01T00:00:00Z"). Default: no lower bound'),
  to: shape.to.describe('End of the range, ISO 8601 UTC. Default: no upper bound'),
};

export function registerGetSecurityPrices(server: McpServer) {
  server.registerTool(
    'get_security_prices',
    {
      description:
        'Stored closing prices of one security, oldest first, each with the date, the close, when it was recorded and its source. Prices are shared by all users and a long-held security has years of daily rows, so pass from and to to keep the answer short. Use get_portfolio_holdings for what a position is worth now.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_security_prices', clientId: extra.authInfo?.clientId });

      // The REST query rule, `from` on or before `to`, which a plain input shape cannot carry.
      const { securityId, from, to } = securityPricesQuerySchema.parse(args);

      const prices = await getPrices({
        securityId,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      });

      const ordered = prices.toSorted((a, b) => a.date.getTime() - b.date.getTime());

      return jsonContent({ data: ordered.map((price) => presentSecurityPrice({ price })) });
    },
  );
}
