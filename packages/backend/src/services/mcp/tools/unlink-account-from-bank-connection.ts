import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { unlinkAccountFromBankConnection } from '@services/accounts.service';

import { presentAccount } from './account-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the bank-connected account to unlink.'),
};

export function registerUnlinkAccountFromBankConnection(server: McpServer) {
  server.registerTool(
    'unlink_account_from_bank_connection',
    {
      description:
        'Disconnect a bank-connected account from its bank. The account becomes a manual account and keeps its whole transaction history, but stops syncing; the bank-side ids are kept only as history. Refused for an account that is not linked.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unlink_account_from_bank_connection', clientId: extra.authInfo?.clientId });

      const account = await unlinkAccountFromBankConnection({ accountId: args.accountId, userId });

      return jsonContent({ data: await presentAccount({ account }) });
    },
  );
}
