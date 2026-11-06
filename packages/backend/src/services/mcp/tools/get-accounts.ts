import { serializeAccounts } from '@root/serializers/accounts.serializer';
import { getAccounts } from '@services/accounts.service';
import { slimAccountsForMcp } from '@services/mcp/serializers';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getAccountsTool = defineTool({
  name: 'get_accounts',
  toolset: 'core',
  access: 'read',
  description:
    'List all user accounts with current balances. Returns account name, type, currency, current balance (in original and base currency), and credit limit.',
  input: {
    type: z.string().optional().describe('Filter by account type (e.g., "checking", "savings", "credit_card")'),
    includeExcludedFromStats: z.boolean().optional().describe('Include accounts excluded from stats. Default: false'),
  },
  run: async ({ userId, args }) => {
    const accounts = await getAccounts({ userId });

    let result = serializeAccounts(accounts);

    if (args.type) {
      result = result.filter((a) => a.type === args.type || a.accountCategory === args.type);
    }
    if (!args.includeExcludedFromStats) {
      result = result.filter((a) => !a.excludeFromStats);
    }

    return slimAccountsForMcp(result);
  },
});
