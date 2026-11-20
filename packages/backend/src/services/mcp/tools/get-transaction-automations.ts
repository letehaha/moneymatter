import { listAutomations } from '@services/transaction-automations/list-automations';

import { defineTool } from '../define-tool';

export const getTransactionAutomationsTool = defineTool({
  name: 'get_transaction_automations',
  toolset: 'automations',
  access: 'read',
  description:
    'List the transaction automation rules (rules engine) of the user, ordered by evaluation order. Call it before updating, deleting, or reordering a rule to get its id. Returned fields: `position` is the 0-based evaluation order (rules run top to bottom on each newly synced or imported bank transaction and the first rule that applies an action wins), `isEnabled` whether the rule runs at all, `matchCount` and `lastMatchedAt` how often and when it last fired, and `pausedReason` which is non-null when a referenced category, tag, payee, or account was deleted (fix the rule and re-enable it). Automations fire only for new transactions on bank-connected accounts or imported rows, never for transfers, planned transactions, or transactions on manual (non-bank) accounts, and never change existing transactions retroactively.',
  run: ({ userId }) => listAutomations({ userId }),
});
