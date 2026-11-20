import { recordId } from '@common/lib/zod/custom-types';
import { deletePayeeAlias } from '@services/payees';

import { defineTool } from '../define-tool';

export const deletePayeeAliasTool = defineTool({
  name: 'delete_payee_alias',
  toolset: 'automations',
  access: 'delete',
  description:
    "Delete one alias of a payee. Transactions already linked through it keep their payee; only future matching changes. The alias that is the payee's own name cannot be deleted (rename the payee with update_payee instead).",
  input: {
    payeeId: recordId().describe('Payee the alias belongs to.'),
    aliasId: recordId().describe('Alias id (from get_payee).'),
  },
  run: async ({ userId, args }) => {
    await deletePayeeAlias({ userId, payeeId: args.payeeId, aliasId: args.aliasId });
    return { deleted: true, aliasId: args.aliasId };
  },
});
