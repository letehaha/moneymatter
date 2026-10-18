import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTransactionTemplates } from '@services/transaction-templates';

import { getUserId, jsonContent } from './helpers';
import { presentTemplate } from './template-output';

export function registerGetTransactionTemplates(server: McpServer) {
  server.registerTool(
    'get_transaction_templates',
    {
      description:
        'List the transaction templates: named presets the user fills a new transaction from (type, and optionally an account, a pinned amount, a category, a payee, a payment type, a note, an original currency and tags). A template is not a transaction and not a recurring rule. To record a transaction from one, read its fields and call create_transaction. Oldest first.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_transaction_templates', clientId: extra.authInfo?.clientId });

      const templates = await getTransactionTemplates({ userId });
      return jsonContent({ data: templates.map((template) => presentTemplate({ template })) });
    },
  );
}
