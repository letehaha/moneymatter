import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deletePortfolioTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transferId: recordId().describe('Portfolio transfer ID (from list_portfolio_transfers)'),
  deleteLinkedTransaction: z
    .boolean()
    .optional()
    .describe(
      'For a transfer made with an account: true also deletes the linked account transaction; false (default) keeps it as a plain transfer transaction',
    ),
};

export function registerDeletePortfolioTransfer(server: McpServer) {
  server.registerTool(
    'delete_portfolio_transfer',
    {
      description:
        'Permanently delete a portfolio transfer, a direct deposit/withdrawal or a currency exchange, and reverse its effect on the portfolio cash balances. For a transfer made with an account, the linked account transaction is kept as a plain transaction unless deleteLinkedTransaction is true. This action is irreversible — confirm with the user before calling. Obtain transferId from list_portfolio_transfers.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_portfolio_transfer', clientId: extra.authInfo?.clientId });

      await deletePortfolioTransfer({
        userId,
        transferId: args.transferId,
        deleteLinkedTransaction: args.deleteLinkedTransaction ?? false,
      });

      return jsonContent({ data: { deleted: true, id: args.transferId } });
    },
  );
}
