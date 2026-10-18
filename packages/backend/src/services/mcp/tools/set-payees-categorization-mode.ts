import { bulkUpdateCategorizationModeBodySchema } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bulkUpdateCategorizationMode } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const bodyShape = bulkUpdateCategorizationModeBodySchema.shape;

const inputSchema = {
  mode: bodyShape.mode.describe(
    'enforce (a payee always sets its default category on new transactions), hint (suggests it) or off (ignores it).',
  ),
};

export function registerSetPayeesCategorizationMode(server: McpServer) {
  server.registerTool(
    'set_payees_categorization_mode',
    {
      description:
        'Set the categorization mode of EVERY payee the user has to the same value, replacing the mode each one has now; there is no way to pick payees. To change one payee, use update_payee. Returns { updatedCount }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_payees_categorization_mode', clientId: extra.authInfo?.clientId });

      const result = await bulkUpdateCategorizationMode({ userId, mode: args.mode });
      return jsonContent({ data: result });
    },
  );
}
