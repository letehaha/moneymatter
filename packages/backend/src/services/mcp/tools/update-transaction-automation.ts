import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateAutomation } from '@services/transaction-automations/update-automation';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { automationActionsInput, automationConditionsInput } from './transaction-automation-inputs';

const inputSchema = {
  id: recordId().describe('UUID of the automation'),
  name: z.string().trim().min(1).max(AUTOMATION_LIMITS.maxNameLength).optional().describe('New display name'),
  isEnabled: z.boolean().optional().describe('Enable or disable the rule'),
  conditions: automationConditionsInput.optional(),
  actions: automationActionsInput.optional(),
};

export function registerUpdateTransactionAutomation(server: McpServer) {
  server.registerTool(
    'update_transaction_automation',
    {
      description:
        'Update a transaction automation rule. Only provided fields change; conditions and actions are replaced wholesale, not merged. Setting isEnabled to true or changing conditions/actions re-validates every referenced category, tag, payee, and account and clears pausedReason, so this is how a rule paused by a deleted reference is repaired. Position is not changed here, use reorder_transaction_automations. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_transaction_automation', clientId: extra.authInfo?.clientId });

      const { id, ...fields } = args;

      const result = await updateAutomation({ userId, id, ...fields });

      return jsonContent({ data: result });
    },
  );
}
