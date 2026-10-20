import { updatePayeeBodyShape } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPayee } from '@services/payees';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentPayee } from './payee-output';

const inputSchema = {
  name: z.string().describe('Display name for the Payee, max 200 chars.'),
  defaultCategoryId: z
    .string()
    .optional()
    .describe('Optional category id automatically applied to future transactions linked to this Payee.'),
  categorizationMode: updatePayeeBodyShape.categorizationMode.describe(
    'How the default category is used on new transactions: enforce (always set it, the default), hint (suggest it) or off (ignore it).',
  ),
  defaultTagIds: updatePayeeBodyShape.defaultTagIds.describe(
    'Tag ids (from get_tags) added to new transactions of this payee. Use apply_payee_tags_to_transactions to tag the existing transactions.',
  ),
  defaultLocation: updatePayeeBodyShape.defaultLocation.describe(
    'Default location { latitude, longitude } stamped on new transactions of this payee.',
  ),
};

export function registerCreatePayee(server: McpServer) {
  server.registerTool(
    'create_payee',
    {
      description:
        'Create a Payee (merchant/counterparty) for the user. Use when the user wants to register a new merchant before linking transactions. Can also set the categorization mode, the default tags and the default location. Returns the created Payee.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_payee', clientId: extra.authInfo?.clientId });

      const payee = await createPayee({
        userId,
        name: args.name,
        defaultCategoryId: args.defaultCategoryId ?? null,
        categorizationMode: args.categorizationMode,
        defaultTagIds: args.defaultTagIds,
        defaultLocation: args.defaultLocation,
      });
      return jsonContent({ data: presentPayee({ payee }) });
    },
  );
}
