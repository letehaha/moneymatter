import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updatePayee } from '@services/payees';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: z.string().describe('Payee id.'),
  name: z.string().optional().describe('New display name.'),
  defaultCategoryId: z.string().nullable().optional().describe('New default category id, or null to clear.'),
};

export function registerUpdatePayee(server: McpServer) {
  server.registerTool(
    'update_payee',
    {
      description:
        'Rename a Payee or set/clear its defaultCategoryId. Renaming preserves the previous canonical name as an alias so historical matches still resolve.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_payee', clientId: extra.authInfo?.clientId });

      const payee = await updatePayee({
        userId,
        id: args.id,
        name: args.name,
        defaultCategoryId: args.defaultCategoryId,
      });
      return jsonContent({
        data: {
          id: payee.id,
          name: payee.name,
          defaultCategoryId: payee.defaultCategoryId,
        },
      });
    },
  );
}
