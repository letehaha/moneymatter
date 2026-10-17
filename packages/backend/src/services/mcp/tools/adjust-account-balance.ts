import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { adjustAccountBalance } from '@services/accounts/balance-adjustment';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the account to adjust.'),
  newBalance: z
    .number()
    .describe('Target balance as a decimal (e.g. 1500.00). An adjustment transaction is created for the diff.'),
  note: z.string().max(1000).optional().describe('Optional note to attach to the adjustment transaction.'),
};

export function registerAdjustAccountBalance(server: McpServer) {
  server.registerTool(
    'adjust_account_balance',
    {
      description:
        'Set an account to a specific balance by creating an adjustment transaction for the difference. Returns the previous balance, new balance, and the generated transaction (null if the balance was already at the target).',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'adjust_account_balance', clientId: extra.authInfo?.clientId });

      const result = await adjustAccountBalance({
        userId,
        accountId: args.accountId,
        targetBalance: Money.fromDecimal(args.newBalance),
        note: args.note,
      });

      return jsonContent({
        data: {
          previousBalance: result.previousBalance,
          newBalance: result.newBalance,
          transaction: result.transaction,
        },
      });
    },
  );
}
