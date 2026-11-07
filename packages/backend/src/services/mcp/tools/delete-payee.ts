import { deletePayee, deletePayeeAndIgnoreFuture } from '@services/payees';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deletePayeeTool = defineTool({
  name: 'delete_payee',
  toolset: 'core',
  access: 'delete',
  description:
    'Delete a Payee. Linked transactions retain their categoryId but their payeeId is set to null. Use cautiously — this is irreversible.',
  input: {
    id: z.string().describe('Payee id to delete.'),
    ignoreFuture: z
      .boolean()
      .optional()
      .describe('true also adds the payee names to the ignore list, so imports never recreate it. Default false'),
  },
  run: async ({ userId, args }) => {
    if (args.ignoreFuture) {
      const { addedCount } = await deletePayeeAndIgnoreFuture({ userId, payeeId: args.id });
      return { ok: true, ignoredAddedCount: addedCount };
    }
    await deletePayee({ userId, id: args.id });
    return { ok: true };
  },
});
