import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mergePayees } from '@services/payees';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  sourceId: z.string().describe('Payee id to merge from (will be deleted).'),
  targetId: z.string().describe('Payee id to merge into (kept).'),
};

export function registerMergePayees(server: McpServer) {
  server.registerTool(
    'merge_payees',
    {
      description:
        'Merge a source Payee into a target Payee. Transactions and aliases move to the target; the target wins silently on defaultCategoryId conflict; the source is deleted. Use to dedupe near-duplicates like "Amazon" and "AMZN MKT". Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      trackMcpToolUsed({ userId, tool: 'merge_payees', clientId: extra.authInfo?.clientId });

      const target = await mergePayees({
        userId,
        sourceId: args.sourceId,
        targetId: args.targetId,
      });
      return jsonContent({
        data: {
          id: target.id,
          name: target.name,
          defaultCategoryId: target.defaultCategoryId,
        },
      });
    },
  );
}
