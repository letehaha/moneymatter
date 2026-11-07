import { recordId } from '@common/lib/zod/custom-types';
import { applyPayeeTagsToExisting } from '@services/payees';

import { defineTool } from '../define-tool';

export const applyPayeeTagsToTransactionsTool = defineTool({
  name: 'apply_payee_tags_to_transactions',
  toolset: 'automations',
  access: 'write',
  description:
    "Add a payee's default tags (set with update_payee) to every transaction already linked to it, planned ones included. It only adds: it never removes a tag, and a tag a transaction already has is skipped. A payee without default tags changes nothing. Returns { updatedTransactionsCount }, the transactions that gained at least one tag.",
  input: {
    payeeId: recordId().describe('Payee whose default tags to apply (from get_payees).'),
  },
  run: ({ userId, args }) => applyPayeeTagsToExisting({ userId, payeeId: args.payeeId }),
});
