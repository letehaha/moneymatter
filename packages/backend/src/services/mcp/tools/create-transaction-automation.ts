import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { trackAutomationCreated, trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAutomation } from '@services/transaction-automations/create-automation';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { automationActionsInput, automationConditionsInput } from './transaction-automation-inputs';

const inputSchema = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(AUTOMATION_LIMITS.maxNameLength)
    .describe('Display name of the rule (e.g. "Groceries to Food")'),
  isEnabled: z.boolean().optional().describe('Defaults to true'),
  conditions: automationConditionsInput,
  actions: automationActionsInput,
};

export function registerCreateTransactionAutomation(server: McpServer) {
  server.registerTool(
    'create_transaction_automation',
    {
      description:
        'Create a transaction automation rule that categorizes, tags, sets a payee, or edits the note of matching transactions. The rule is appended last in evaluation order and only fires for newly synced or imported bank transactions that are not transfers and not planned; existing transactions are never changed retroactively. Preview the conditions with preview_transaction_automation first. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_transaction_automation', clientId: extra.authInfo?.clientId });

      const result = await createAutomation({
        userId,
        name: args.name,
        isEnabled: args.isEnabled,
        conditions: args.conditions,
        actions: args.actions,
      });

      trackAutomationCreated({
        userId,
        source: 'mcp',
        conditions: result.conditions,
        actions: result.actions,
      });

      return jsonContent({ data: result });
    },
  );
}
