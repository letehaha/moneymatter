import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { updateAutomation } from '@services/transaction-automations/update-automation';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { automationActionsInput, automationConditionsInput } from './transaction-automation-inputs';

export const updateTransactionAutomationTool = defineTool({
  name: 'update_transaction_automation',
  toolset: 'automations',
  access: 'write',
  description:
    'Update a transaction automation rule. Only provided fields change; conditions and actions are replaced wholesale, not merged. Setting isEnabled to true or changing conditions/actions re-validates every referenced category, tag, payee, and account and clears pausedReason, so this is how a rule paused by a deleted reference is repaired. Position is not changed here, use reorder_transaction_automations.',
  input: {
    id: recordId().describe('UUID of the automation'),
    name: z.string().trim().min(1).max(AUTOMATION_LIMITS.maxNameLength).optional().describe('New display name'),
    isEnabled: z.boolean().optional().describe('Enable or disable the rule'),
    conditions: automationConditionsInput.optional(),
    actions: automationActionsInput.optional(),
  },
  run: ({ userId, args: { id, ...fields } }) => updateAutomation({ userId, id, ...fields }),
});
