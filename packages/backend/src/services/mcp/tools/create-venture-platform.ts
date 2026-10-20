import { createVenturePlatformBodyShape } from '@controllers/venture/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createVenturePlatform } from '@services/venture/platforms/create.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: createVenturePlatformBodyShape.name.describe('Platform name (must be unique for this user)'),
  website: createVenturePlatformBodyShape.website.describe('Platform website URL'),
  description: createVenturePlatformBodyShape.description.describe('Free-text description'),
  defaultEntryFeePct: createVenturePlatformBodyShape.defaultEntryFeePct.describe(
    'Default entry fee as a decimal fraction in [0,1] (e.g. 0.085 for 8.5%). Defaults to 0.',
  ),
  defaultMgmtFeePct: createVenturePlatformBodyShape.defaultMgmtFeePct.describe(
    'Default management fee as a decimal fraction in [0,1]. Defaults to 0.',
  ),
  defaultCarryPct: createVenturePlatformBodyShape.defaultCarryPct.describe(
    'Default carry as a decimal fraction in [0,1] (e.g. 0.2 for 20%). Defaults to 0.',
  ),
  defaultHurdlePct: createVenturePlatformBodyShape.defaultHurdlePct.describe(
    'Default hurdle rate as a decimal fraction in [0,1]. Defaults to 0.',
  ),
};

export function registerCreateVenturePlatform(server: McpServer) {
  server.registerTool(
    'create_venture_platform',
    {
      description:
        "Create a venture investment platform (e.g. AngelList, a syndicate, a fund manager) so its default fees can be auto-applied when creating new deals. Fee fields are decimal fractions in [0,1] — e.g. pass 0.085 for 8.5%, NOT 8.5. Returns the created platform's id for use with create_venture_deal.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_venture_platform', clientId: extra.authInfo?.clientId });

      const platform = await createVenturePlatform({
        userId,
        name: args.name,
        website: args.website ?? null,
        description: args.description ?? null,
        defaultEntryFeePct: args.defaultEntryFeePct,
        defaultMgmtFeePct: args.defaultMgmtFeePct,
        defaultCarryPct: args.defaultCarryPct,
        defaultHurdlePct: args.defaultHurdlePct,
      });

      return jsonContent({ data: platform });
    },
  );
}
