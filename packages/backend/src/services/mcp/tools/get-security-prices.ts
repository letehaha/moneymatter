import { recordId } from '@common/lib/zod/custom-types';
import { securityPricesQuerySchema } from '@controllers/investments/prices/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPrices } from '@services/investments/securities-price/get-prices.service';
import { subDays } from 'date-fns';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentSecurityPrice } from './holding-output';

const shape = securityPricesQuerySchema.shape;

const DEFAULT_WINDOW_DAYS = 365;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

const inputSchema = {
  securityId: recordId().describe('Security ID (from get_portfolio_holdings or create_holding)'),
  from: shape.from.describe(
    `Start of the range, ISO 8601 UTC (e.g. "2026-01-01T00:00:00Z"). Default: ${DEFAULT_WINDOW_DAYS} days before to (or before now)`,
  ),
  to: shape.to.describe('End of the range, ISO 8601 UTC. Default: no upper bound'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Most rows to return, the newest of the range (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
};

export function registerGetSecurityPrices(server: McpServer) {
  server.registerTool(
    'get_security_prices',
    {
      description:
        'Stored closing prices of one security, oldest first, each with the date, the close, when it was recorded and its source, as { prices, total }. Without from the range starts 365 days before to (or before now), and at most limit rows come back (default 500, max 5000), the newest of the range, so total tells you when rows were left out: narrow from and to to see them. Use get_portfolio_holdings for what a position is worth now.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_security_prices', clientId: extra.authInfo?.clientId });

      // The REST query rule, `from` on or before `to`, which a plain input shape cannot carry.
      const { securityId, from, to } = securityPricesQuerySchema.parse(args);

      const toDate = to ? new Date(to) : undefined;
      // Prices are shared by all users and can be hourly, so an open range is cut to a year.
      const fromDate = from ? new Date(from) : subDays(toDate ?? new Date(), DEFAULT_WINDOW_DAYS);

      const prices = await getPrices({ securityId, from: fromDate, to: toDate });

      const ordered = prices.toSorted((a, b) => a.date.getTime() - b.date.getTime());

      return jsonContent({
        data: {
          prices: ordered.slice(-(args.limit ?? DEFAULT_LIMIT)).map((price) => presentSecurityPrice({ price })),
          total: ordered.length,
        },
      });
    },
  );
}
