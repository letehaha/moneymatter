import { BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createBudget } from '@services/budgets/create-budget';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Tracker name'),
  status: z
    .enum([BUDGET_STATUSES.active, BUDGET_STATUSES.archived, BUDGET_STATUSES.closed])
    .optional()
    .describe('Tracker status (default: active)'),
  type: z
    .enum([BUDGET_TYPES.manual, BUDGET_TYPES.category])
    .optional()
    .describe(
      'Tracker type: manual (transactions linked explicitly) or category (auto-tracks by category). Default: manual',
    ),
  categoryIds: z.array(recordId()).optional().describe('Category IDs to link (only used when type is "category")'),
  startDate: z.string().optional().describe('Tracker start date (ISO 8601)'),
  endDate: z.string().optional().describe('Tracker end date (ISO 8601)'),
  autoInclude: z
    .boolean()
    .optional()
    .describe('Auto-include transactions in the date range when creating (manual trackers only)'),
  limitAmount: z
    .number()
    .optional()
    .describe("Spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
};

export function registerCreateBudget(server: McpServer) {
  server.registerTool(
    'create_budget',
    {
      description:
        'Create a tracker (a "budget" in tool and field names) with an optional spending limit, date range, and linked categories. It does not create or change the period-based Budget plan. Returns the created tracker with its ID, status, type, and associated categories.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'create_budget', clientId: extra.authInfo?.clientId });

      const budget = await createBudget({
        userId,
        name: args.name,
        status: args.status ?? BUDGET_STATUSES.active,
        type: args.type,
        categoryIds: args.categoryIds,
        startDate: args.startDate ? new Date(args.startDate) : undefined,
        endDate: args.endDate ? new Date(args.endDate) : undefined,
        autoInclude: args.autoInclude,
        limitAmount: args.limitAmount !== undefined ? Money.fromDecimal(args.limitAmount) : undefined,
      });

      return jsonContent({ data: budget });
    },
  );
}
