import { recordId } from '@common/lib/zod/custom-types';
import { updatePayeeBodySchema, updatePayeeBodyShape } from '@controllers/payees/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updatePayee } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentPayee } from './payee-output';

const inputSchema = {
  id: recordId().describe('Payee id.'),
  name: updatePayeeBodyShape.name.describe('New display name, 1 to 200 characters.'),
  defaultCategoryId: updatePayeeBodyShape.defaultCategoryId.describe('New default category id, or null to clear.'),
  categorizationMode: updatePayeeBodyShape.categorizationMode.describe(
    'How the default category is used on new transactions: enforce (always set it), hint (suggest it) or off (ignore it).',
  ),
  defaultTagIds: updatePayeeBodyShape.defaultTagIds.describe(
    'The full set of default tags for new transactions of this payee. It replaces the current set; [] clears it. Use apply_payee_tags_to_transactions to tag the existing transactions.',
  ),
  defaultLocation: updatePayeeBodyShape.defaultLocation.describe(
    'Default location { latitude, longitude } stamped on new transactions of this payee, or null to clear.',
  ),
  logoDomain: updatePayeeBodyShape.logoDomain.describe(
    'Brand domain to take the logo from (e.g. "netflix.com", no protocol or slashes), or null to clear. Not together with logoInitials.',
  ),
  logoInitials: updatePayeeBodyShape.logoInitials.describe(
    'One or two characters shown as a monogram instead of a brand logo, or null to clear. Not together with logoDomain.',
  ),
  logoColor: updatePayeeBodyShape.logoColor.describe('Monogram background as #rrggbb, or null for the default tint.'),
  logoIcon: updatePayeeBodyShape.logoIcon.describe(
    'Icon key shown instead of a brand logo or monogram (e.g. "food-24-regular"), or null to clear. Not together with logoDomain or logoInitials.',
  ),
};

export function registerUpdatePayee(server: McpServer) {
  server.registerTool(
    'update_payee',
    {
      description:
        'Update a Payee. Leave a field out to keep it. Renaming preserves the previous canonical name as an alias so historical matches still resolve, and refuses a name another payee or alias already uses. Sets the default category and how it is applied (categorizationMode), the default tags and the default location for new transactions, and the logo (a brand domain or a monogram, not both; a logo set here is kept as manual). Returns the Payee. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_payee', clientId: extra.authInfo?.clientId });

      // The logo either-or rule spans fields, so it runs on the REST body schema, not on the shape.
      const { id, ...rest } = args;
      const body = updatePayeeBodySchema.parse(rest);

      const payee = await updatePayee({
        userId,
        id,
        name: body.name,
        defaultCategoryId: body.defaultCategoryId,
        categorizationMode: body.categorizationMode,
        defaultTagIds: body.defaultTagIds,
        defaultLocation: body.defaultLocation,
        logoDomain: body.logoDomain,
        logoInitials: body.logoInitials,
        logoColor: body.logoColor,
        logoIcon: body.logoIcon,
      });
      return jsonContent({ data: presentPayee({ payee }) });
    },
  );
}
