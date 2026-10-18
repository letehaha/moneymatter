import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyAutomationToHistory } from '@services/transaction-automations/apply-to-history';
import { applyAutomationBodySchema } from '@services/transaction-automations/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  automationId: recordId().describe('Automation rule id (from get_transaction_automations).'),
  transactionIds: applyAutomationBodySchema.shape.transactionIds.describe(
    'Existing transactions to run the rule on: 1 to 500 unique ids (from search_transactions).',
  ),
};

export function registerApplyTransactionAutomation(server: McpServer) {
  server.registerTool(
    'apply_transaction_automation',
    {
      description:
        "Run one saved automation rule on existing transactions, writing the rule's actions to them. The rule's conditions are checked again for every id, and an id that no longer matches or is ineligible is skipped, not written. Find candidates with preview_transaction_automation first. Returns { appliedCount, skippedIds, categorizedAt }. The rule's match count is not changed. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'apply_transaction_automation', clientId: extra.authInfo?.clientId });

      const result = await applyAutomationToHistory({
        userId,
        ruleId: args.automationId,
        transactionIds: args.transactionIds,
      });
      return jsonContent({ data: result });
    },
  );
}
