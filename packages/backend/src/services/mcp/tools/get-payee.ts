import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPayee } from '@services/payees';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  id: z.string().describe('Payee id.'),
};

export function registerGetPayee(server: McpServer) {
  server.registerTool(
    'get_payee',
    {
      description:
        'Fetch a single Payee with aliases and computed stats. Useful when the user references a merchant by id and wants its full record.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_payee', clientId: extra.authInfo?.clientId });

      const { payee, stats } = await getPayee({ userId, id: args.id });
      return jsonContent({
        data: {
          id: payee.id,
          name: payee.name,
          defaultCategoryId: payee.defaultCategoryId,
          aliases:
            payee.aliases?.map((a) => ({
              id: a.id,
              rawName: a.rawName,
              normalizedName: a.normalizedName,
            })) ?? [],
          stats: stats
            ? {
                payeeId: stats.payeeId,
                transactionCount: stats.transactionCount,
                netFlowRef: stats.netFlowRef.toNumber(),
                firstSeenAt: stats.firstSeenAt,
                lastSeenAt: stats.lastSeenAt,
                topCategoryId: stats.topCategoryId,
              }
            : null,
        },
      });
    },
  );
}
