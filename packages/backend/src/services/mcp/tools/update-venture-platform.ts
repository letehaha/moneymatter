import { percentageFraction, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateVenturePlatform } from '@services/venture/platforms/update.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  platformId: recordId().describe('Venture platform ID (from list_venture_platforms)'),
  name: z.string().optional().describe('New platform name (must be unique for this user)'),
  website: z.string().nullable().optional().describe('New website URL (pass null to clear)'),
  description: z.string().nullable().optional().describe('New description (pass null to clear)'),
  defaultEntryFeePct: percentageFraction()
    .optional()
    .describe('New default entry fee as a decimal fraction in [0,1] (e.g. 0.085 for 8.5%).'),
  defaultMgmtFeePct: percentageFraction()
    .optional()
    .describe('New default management fee as a decimal fraction in [0,1].'),
  defaultCarryPct: percentageFraction()
    .optional()
    .describe('New default carry as a decimal fraction in [0,1] (e.g. 0.2 for 20%).'),
  defaultHurdlePct: percentageFraction().optional().describe('New default hurdle rate as a decimal fraction in [0,1].'),
};

export function registerUpdateVenturePlatform(server: McpServer) {
  server.registerTool(
    'update_venture_platform',
    {
      description:
        "Update an existing venture platform's name, website, description, or default fees. Only provided fields change. Updating default fees does NOT retroactively change fees on existing deals — those are snapshotted at deal creation. Fee fractions are decimals in [0,1].",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_venture_platform', clientId: extra.authInfo?.clientId });

      const platform = await updateVenturePlatform({
        userId,
        platformId: args.platformId,
        name: args.name,
        website: args.website,
        description: args.description,
        defaultEntryFeePct: args.defaultEntryFeePct,
        defaultMgmtFeePct: args.defaultMgmtFeePct,
        defaultCarryPct: args.defaultCarryPct,
        defaultHurdlePct: args.defaultHurdlePct,
      });

      return jsonContent({ data: platform });
    },
  );
}
