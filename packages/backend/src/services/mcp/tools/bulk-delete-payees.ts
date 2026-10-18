import { bulkDeletePayeesBodySchema, MAX_BULK_DELETE_PAYEE_IDS } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bulkDeletePayees } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const bodyShape = bulkDeletePayeesBodySchema.shape;

const inputSchema = {
  ids: bodyShape.ids.describe(`Payee ids to delete: 1 to ${MAX_BULK_DELETE_PAYEE_IDS}, no repeats (from get_payees).`),
  ignoreFuture: bodyShape.ignoreFuture.describe(
    'true to also add every name and alias of the deleted payees to the ignored list, so they are not created again. Default false.',
  ),
};

export function registerBulkDeletePayees(server: McpServer) {
  server.registerTool(
    'bulk_delete_payees',
    {
      description:
        'Permanently delete many payees at once. Their transactions stay and lose the payee; their aliases go with them; automations that use a deleted payee are paused. All or nothing: one unknown id refuses the whole call and deletes nothing. Returns { deletedCount, ignoredAddedCount }. Irreversible. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'bulk_delete_payees', clientId: extra.authInfo?.clientId });

      const result = await bulkDeletePayees({ userId, ids: args.ids, ignoreFuture: args.ignoreFuture ?? false });
      return jsonContent({ data: result });
    },
  );
}
