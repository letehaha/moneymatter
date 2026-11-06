import { bulkDeletePayeesBodySchema, MAX_BULK_DELETE_PAYEE_IDS } from '@controllers/payees/shared-schemas';
import { bulkDeletePayees } from '@services/payees';

import { defineTool } from '../define-tool';

const bodyShape = bulkDeletePayeesBodySchema.shape;

export const bulkDeletePayeesTool = defineTool({
  name: 'bulk_delete_payees',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete many payees at once. Their transactions stay and lose the payee; their aliases go with them; automations that use a deleted payee are paused. All or nothing: one unknown id refuses the whole call and deletes nothing. Returns { deletedCount, ignoredAddedCount }. Irreversible.',
  input: {
    ids: bodyShape.ids.describe(
      `Payee ids to delete: 1 to ${MAX_BULK_DELETE_PAYEE_IDS}, no repeats (from get_payees).`,
    ),
    ignoreFuture: bodyShape.ignoreFuture.describe(
      'true to also add every name and alias of the deleted payees to the ignored list, so they are not created again. Default false.',
    ),
  },
  run: ({ userId, args }) => bulkDeletePayees({ userId, ids: args.ids, ignoreFuture: args.ignoreFuture ?? false }),
});
