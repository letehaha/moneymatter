import { recordId } from '@common/lib/zod/custom-types';
import { deleteAutomation } from '@services/transaction-automations/delete-automation';

import { defineTool } from '../define-tool';

export const deleteTransactionAutomationTool = defineTool({
  name: 'delete_transaction_automation',
  toolset: 'automations',
  access: 'delete',
  description:
    'Permanently delete a transaction automation rule. Transactions the rule already changed keep their values. This cannot be undone, so only call it when the user explicitly confirms deletion; to stop a rule temporarily set isEnabled to false via update_transaction_automation instead. Returns { success: true } on completion.',
  input: {
    id: recordId().describe('UUID of the automation to delete'),
  },
  run: async ({ userId, args }) => {
    await deleteAutomation({ userId, id: args.id });

    return { success: true };
  },
});
