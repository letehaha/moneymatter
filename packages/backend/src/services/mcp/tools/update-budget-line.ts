import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTrackerLine } from '@root/serializers';
import { updateTrackerLine } from '@services/budgets/lines/update-line';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker the line belongs to'),
  lineId: recordId().describe('ID of the line to update'),
  name: z.string().trim().min(1).max(200).optional().describe('New line name'),
  categoryIds: z
    .array(recordId())
    .min(1)
    .optional()
    .describe('Replace the categories the line covers; parents expand to their children'),
  limitAmount: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe("New line limit as a decimal amount in the tracker owner's base currency. Pass null to remove the limit"),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('New 0-based order. Earlier lines win when category sets overlap'),
};

export function registerUpdateBudgetLine(server: McpServer) {
  server.registerTool(
    'update_budget_line',
    {
      description:
        'Update a tracker line (trackers are "budget" in tool and field names): name, categories, limit, or position. Only passed fields change. A transaction lands in at most one line — the first line by position whose category set (expanded to children) contains its category; spending matching no line counts as "other". Requires manage access to the tracker. Returns the updated line.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'update_budget_line', clientId: extra.authInfo?.clientId });

      const line = await updateTrackerLine({
        userId,
        budgetId: args.budgetId,
        lineId: args.lineId,
        name: args.name,
        categoryIds: args.categoryIds,
        limitAmount: args.limitAmount == null ? args.limitAmount : Money.fromDecimal(args.limitAmount),
        position: args.position,
      });

      return jsonContent({ data: serializeTrackerLine(line) });
    },
  );
}
