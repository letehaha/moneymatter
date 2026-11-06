import { recordId } from '@common/lib/zod/custom-types';
import { applyAutomationToHistory } from '@services/transaction-automations/apply-to-history';
import { applyAutomationBodySchema } from '@services/transaction-automations/zod-schemas';

import { defineTool } from '../define-tool';

export const applyTransactionAutomationTool = defineTool({
  name: 'apply_transaction_automation',
  toolset: 'automations',
  access: 'write',
  description:
    "Run one saved automation rule on existing transactions, writing the rule's actions to them. The rule's conditions are checked again for every id, and an id that no longer matches or is ineligible is skipped, not written. Find candidates with preview_transaction_automation first. Returns { appliedCount, skippedIds, categorizedAt }. The rule's match count is not changed.",
  input: {
    automationId: recordId().describe('Automation rule id (from get_transaction_automations).'),
    transactionIds: applyAutomationBodySchema.shape.transactionIds.describe(
      'Existing transactions to run the rule on: 1 to 500 unique ids (from search_transactions).',
    ),
  },
  run: ({ userId, args }) =>
    applyAutomationToHistory({
      userId,
      ruleId: args.automationId,
      transactionIds: args.transactionIds,
    }),
});
