import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTrackerLine } from '@root/serializers';
import { createTrackerLine } from '@services/trackers/lines/create-line';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to add the line to'),
  name: z.string().trim().min(1).max(200).describe('Line name'),
  categoryIds: z
    .array(recordId())
    .min(1)
    .describe(
      "Category IDs the line covers; parents expand to their children. Categories resolve against the tracker owner's tree.",
    ),
  limitAmount: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Line spending limit as a decimal amount in the tracker owner's base currency (e.g. 200.00). Omit or null for no limit",
    ),
  position: z.number().int().min(0).optional().describe('0-based order among the lines. Default: after the last line'),
};

export function registerCreateTrackerLine(server: McpServer) {
  server.registerTool(
    'create_tracker_line',
    {
      description:
        'Add a line to a tracker: a named category set with its own optional limit. A transaction lands in at most one line — the first line by position whose category set (expanded to children) contains its category; spending matching no line counts as "other". Requires manage access to the tracker. Returns the created line with its ID, limit and categories.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_tracker_line', clientId: extra.authInfo?.clientId });

      const line = await createTrackerLine({
        userId,
        trackerId: args.trackerId,
        name: args.name,
        categoryIds: args.categoryIds,
        limitAmount: args.limitAmount == null ? args.limitAmount : Money.fromDecimal(args.limitAmount),
        position: args.position,
      });

      return jsonContent({ data: serializeTrackerLine(line) });
    },
  );
}
