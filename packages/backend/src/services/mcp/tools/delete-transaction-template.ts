import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteTransactionTemplate } from '@services/transaction-templates';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  templateId: recordId().describe('Template id (from get_transaction_templates).'),
};

export function registerDeleteTransactionTemplate(server: McpServer) {
  server.registerTool(
    'delete_transaction_template',
    {
      description:
        'Permanently delete a transaction template. Transactions already created from it are not affected. Only call when the user explicitly confirms deletion. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_transaction_template', clientId: extra.authInfo?.clientId });

      await deleteTransactionTemplate({ id: args.templateId, userId });
      return jsonContent({ data: { deleted: true, templateId: args.templateId } });
    },
  );
}
