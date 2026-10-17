import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { unlinkTransactionFromPortfolio } from '@services/investments/portfolios/transfers';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of the transaction currently linked to a portfolio'),
};

export function registerUnlinkTransactionFromPortfolio(server: McpServer) {
  server.registerTool(
    'unlink_transaction_from_portfolio',
    {
      description:
        'Remove the portfolio link from a transaction: deletes the portfolio transfer, reverses the portfolio cash balance change, and restores the transaction to a regular income/expense. Succeeds even if the transaction has no portfolio link.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unlink_transaction_from_portfolio', clientId: extra.authInfo?.clientId });

      const result = await unlinkTransactionFromPortfolio({
        userId,
        transactionId: args.transactionId,
      });

      return jsonContent({ data: result });
    },
  );
}
