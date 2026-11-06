import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { uniqueRecordIds } from '@common/lib/zod/custom-types';
import { reorderAutomations } from '@services/transaction-automations/reorder-automations';

import { defineTool } from '../define-tool';

export const reorderTransactionAutomationsTool = defineTool({
  name: 'reorder_transaction_automations',
  toolset: 'automations',
  access: 'write',
  description:
    'Reorder the transaction automation rules of the user. Rules are evaluated top to bottom on each newly synced or imported bank transaction and the first rule that applies an action wins, so ordering decides which rule takes precedence when several match. Returns the rules in their new order.',
  input: {
    ids: uniqueRecordIds({ max: AUTOMATION_LIMITS.maxRules }).describe(
      'Every automation id of the user, in the desired top-to-bottom order. Must contain exactly the current full set (get it from get_transaction_automations first) or the call fails with a conflict.',
    ),
  },
  run: ({ userId, args }) => reorderAutomations({ userId, ids: args.ids }),
});
