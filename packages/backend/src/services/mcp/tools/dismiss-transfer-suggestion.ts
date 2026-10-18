import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dismissTransferSuggestion } from '@services/transactions/transactions-linking/dismiss-transfer-suggestion.service';
import { dismissBodySchema } from '@services/transactions/transactions-linking/recommendation-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  expenseTransactionId: recordId().describe('The expense of the suggested pair'),
  incomeTransactionId: recordId().describe('The income of the suggested pair'),
};

export function registerDismissTransferSuggestion(server: McpServer) {
  server.registerTool(
    'dismiss_transfer_suggestion',
    {
      description:
        "Tell MoneyMatter that a suggested expense/income pair is not a transfer, so list_transfer_suggestions stops offering that pair. Both transactions must be the caller's. Nothing is linked or deleted, and dismissing the same pair twice is harmless. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'dismiss_transfer_suggestion', clientId: extra.authInfo?.clientId });

      const body = dismissBodySchema.parse(args);
      await dismissTransferSuggestion({ userId, ...body });

      return jsonContent({ data: { dismissed: true, ...body } });
    },
  );
}
