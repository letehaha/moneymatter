import { recordId } from '@common/lib/zod/custom-types';
import { createPayeeAliasBodySchema } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPayeeAlias } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentPayee } from './payee-output';

const bodyShape = createPayeeAliasBodySchema.shape;

const inputSchema = {
  payeeId: recordId().describe('Payee the alias belongs to (from get_payees).'),
  rawName: bodyShape.rawName.describe(
    'The name as it appears on transactions, e.g. "NFLX*SUBSCRIPTION" (1 to 500 characters).',
  ),
};

export function registerCreatePayeeAlias(server: McpServer) {
  server.registerTool(
    'create_payee_alias',
    {
      description:
        "Add an alias to a payee: another name that links future transactions to it. Refused when the name is already the payee's own name or an alias, or belongs to another payee (use merge_payees to join two payees). Existing transactions are not re-linked. Returns the payee with its aliases. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_payee_alias', clientId: extra.authInfo?.clientId });

      const payee = await createPayeeAlias({ userId, payeeId: args.payeeId, rawName: args.rawName });
      return jsonContent({ data: presentPayee({ payee }) });
    },
  );
}
