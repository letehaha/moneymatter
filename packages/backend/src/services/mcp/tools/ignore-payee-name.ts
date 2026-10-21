import { addIgnoredNameBodySchema } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addPayeeIgnoredName } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentIgnoredName } from './payee-output';

const bodyShape = addIgnoredNameBodySchema.shape;

const inputSchema = {
  rawName: bodyShape.rawName.describe('The name to ignore, as it appears on transactions (1 to 500 characters).'),
  force: bodyShape.force.describe(
    'true to delete the payee the name already resolves to (by its name or an alias), permanently, so the ignore takes effect. Needs finance:delete scope. Default false: the call is refused in that case.',
  ),
};

export function registerIgnorePayeeName(server: McpServer) {
  server.registerTool(
    'ignore_payee_name',
    {
      description:
        'Add a name to the ignored list, so it is never turned into a payee automatically when transactions are imported or synced. Adding a name already on the list returns the existing row. When the name still resolves to a payee, by its name or one of its aliases, the call is refused and names that payee, because the ignore would not take effect; with force: true it deletes that payee permanently (its transactions stay and lose the payee), which additionally needs finance:delete scope. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      // `force` makes the service delete a payee for good, so it asks for the delete scope up front.
      if (args.force) requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'ignore_payee_name', clientId: extra.authInfo?.clientId });

      const row = await addPayeeIgnoredName({ userId, rawName: args.rawName, force: args.force ?? false });
      return jsonContent({ data: presentIgnoredName({ row }) });
    },
  );
}
