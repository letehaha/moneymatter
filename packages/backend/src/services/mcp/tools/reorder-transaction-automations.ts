import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { uniqueRecordIds } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { reorderAutomations } from '@services/transaction-automations/reorder-automations';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  ids: uniqueRecordIds({ max: AUTOMATION_LIMITS.maxRules }).describe(
    'Every automation id of the user, in the desired top-to-bottom order. Must contain exactly the current full set (get it from get_transaction_automations first) or the call fails with a conflict.',
  ),
};

export function registerReorderTransactionAutomations(server: McpServer) {
  server.registerTool(
    'reorder_transaction_automations',
    {
      description:
        'Reorder the transaction automation rules of the user. Rules are evaluated top to bottom on each newly synced or imported bank transaction and the first rule that applies an action wins, so ordering decides which rule takes precedence when several match. Returns the rules in their new order. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'reorder_transaction_automations', clientId: extra.authInfo?.clientId });

      const result = await reorderAutomations({ userId, ids: args.ids });

      return jsonContent({ data: result });
    },
  );
}
