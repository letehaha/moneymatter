import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { trackAutomationCreated } from '@js/utils/posthog';
import { createAutomation } from '@services/transaction-automations/create-automation';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { automationActionsInput, automationConditionsInput } from './transaction-automation-inputs';

export const createTransactionAutomationTool = defineTool({
  name: 'create_transaction_automation',
  toolset: 'automations',
  access: 'write',
  description:
    'Create a transaction automation rule that categorizes, tags, sets a payee, or edits the note of matching transactions. The rule is appended last in evaluation order and only fires for newly synced or imported bank transactions that are not transfers and not planned; existing transactions are never changed retroactively. Preview the conditions with preview_transaction_automation first.',
  input: {
    name: z
      .string()
      .trim()
      .min(1)
      .max(AUTOMATION_LIMITS.maxNameLength)
      .describe('Display name of the rule (e.g. "Groceries to Food")'),
    isEnabled: z.boolean().optional().describe('Defaults to true'),
    conditions: automationConditionsInput,
    actions: automationActionsInput,
  },
  run: async ({ userId, args }) => {
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

    return result;
  },
});
