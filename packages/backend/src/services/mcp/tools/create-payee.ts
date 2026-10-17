import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPayee } from '@services/payees';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Display name for the Payee, max 200 chars.'),
  defaultCategoryId: z
    .string()
    .optional()
    .describe('Optional category id automatically applied to future transactions linked to this Payee.'),
};

export function registerCreatePayee(server: McpServer) {
  server.registerTool(
    'create_payee',
    {
      description:
        'Create a Payee (merchant/counterparty) for the user. Use when the user wants to register a new merchant before linking transactions. Returns the created Payee.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_payee', clientId: extra.authInfo?.clientId });

      const payee = await createPayee({
        userId,
        name: args.name,
        defaultCategoryId: args.defaultCategoryId ?? null,
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
