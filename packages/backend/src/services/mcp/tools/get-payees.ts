import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listPayees } from '@services/payees';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  q: z.string().optional().describe('Substring filter applied to the normalized Payee name.'),
};

export function registerGetPayees(server: McpServer) {
  server.registerTool(
    'get_payees',
    {
      description:
        'List Payees (merchants/counterparties) for the user, optionally filtered by a substring query. Returns Payee id, name, defaultCategoryId, and aggregated stats (transactionCount, netFlowRef, top category, last seen).',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_payees', clientId: extra.authInfo?.clientId });

      const rows = await listPayees({ userId, q: args.q });
      const data = rows.map(({ payee, stats }) => ({
        id: payee.id,
        name: payee.name,
        defaultCategoryId: payee.defaultCategoryId,
        transactionCount: stats?.transactionCount ?? 0,
        netFlowRef: stats ? stats.netFlowRef.toNumber() : 0,
        firstSeenAt: stats?.firstSeenAt ?? null,
        lastSeenAt: stats?.lastSeenAt ?? null,
        topCategoryId: stats?.topCategoryId ?? null,
      }));
      return jsonContent({ data });
    },
  );
}
