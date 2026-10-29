import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteAccountById } from '@services/accounts.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the account to delete.'),
  removePortfolioTransfers: z
    .boolean()
    .optional()
    .describe(
      'Also remove the portfolio transfers that touch this account. Without it, an account with portfolio transfers is refused.',
    ),
};

export function registerDeleteAccount(server: McpServer) {
  server.registerTool(
    'delete_account',
    {
      description:
        'Permanently delete an account together with all its transactions. Irreversible: call get_account first and read its transactionCount. To keep the history, use archive_account instead. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_account', clientId: extra.authInfo?.clientId });

      await deleteAccountById({
        id: args.accountId,
        userId,
        removePortfolioTransfers: args.removePortfolioTransfers,
      });

      return jsonContent({ data: { deleted: true, accountId: args.accountId } });
    },
  );
}
