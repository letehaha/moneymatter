import { previewAutomation } from '@services/transaction-automations/preview';

import { defineTool } from '../define-tool';
import { automationConditionsInput } from './transaction-automation-inputs';

export const previewTransactionAutomationTool = defineTool({
  name: 'preview_transaction_automation',
  toolset: 'automations',
  access: 'read',
  // POST /automations/preview carries the base-currency lock in REST, though it only reads.
  lock: true,
  description:
    'Dry-run a set of automation conditions against up to the last 1000 eligible existing transactions and return { matchedCount, scannedCount, matches } where matches is capped at 5 sample transactions. Nothing is modified. Use it to sanity-check conditions before create_transaction_automation or update_transaction_automation. Note that a live automation fires on its own only for newly synced or imported bank transactions that are not transfers and not planned; existing transactions change only when the user runs "Apply to past transactions" for a saved rule in the app.',
  input: {
    conditions: automationConditionsInput,
  },
  run: ({ userId, args }) => previewAutomation({ userId, conditions: args.conditions }),
});
