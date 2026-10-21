import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAccountById } from '@services/accounts.service';
import { getAccountTransactionCount } from '@services/accounts/transaction-count';

import { presentAccount } from './account-output';
import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the account to read.'),
};

export function registerGetAccount(server: McpServer) {
  server.registerTool(
    'get_account',
    {
      description:
        'Read one account: balances (original and base currency), opening balance, credit limit, category, status, bank link and logo, plus transactionCount, the number of transactions the account holds (null for an account shared with the user). Use it before update_account or delete_account.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_account', clientId: extra.authInfo?.clientId });

      const account = await getAccountById({ userId, id: args.accountId });
      const detail = presentAccount({ account });

      // The count is owner-scoped, as in REST: a share recipient can read the account but
      // cannot delete it.
      const isOwner = account?.userId === userId;
      const transactionCount = isOwner ? await getAccountTransactionCount({ userId, accountId: args.accountId }) : null;

      return jsonContent({ data: { ...detail, transactionCount } });
    },
  );
}
