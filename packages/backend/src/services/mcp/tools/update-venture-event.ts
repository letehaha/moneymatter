import { dateString, decimalString, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateVentureEvent } from '@services/venture/events/update.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  eventId: recordId().describe('Venture event ID (from list_venture_events)'),
  eventDate: dateString().optional().describe('New event date (YYYY-MM-DD)'),
  grossAmount: decimalString().nullable().optional().describe('New gross amount (decimal string)'),
  navAfter: decimalString().nullable().optional().describe('New post-event NAV (decimal string)'),
  quantityPct: decimalString().nullable().optional().describe('New partial-exit quantity fraction in [0,1]'),
  notes: z.string().nullable().optional().describe('New notes (or null to clear)'),
  gpCarryAmount: decimalString()
    .nullable()
    .optional()
    .describe('Set the manual gpCarry override; flips gpCarryOverridden=true. To clear, use resetOverrides=true.'),
  lpNetAmount: decimalString()
    .nullable()
    .optional()
    .describe(
      'Set the manual lpNetAmount override; flips lpNetAmountOverridden=true. To clear, use resetOverrides=true.',
    ),
  resetOverrides: z
    .boolean()
    .optional()
    .describe('When true, clears both override flags and re-computes carry from deal terms.'),
};

export function registerUpdateVentureEvent(server: McpServer) {
  server.registerTool(
    'update_venture_event',
    {
      description:
        'Update a venture event. Only provided fields change. eventDate must stay on/after the initial_investment date (and moving an initial_investment past existing later events is rejected).\n\nOverride semantics for gpCarryAmount / lpNetAmount:\n  • Omit the field → no change.\n  • Pass a string value → set the manual override; flips the corresponding *Overridden flag to true.\n  • Pass null → currently treated the same as omitting (no semantic clear). To clear an existing override, use `resetOverrides: true` instead.\n\nThe event type cannot be changed — delete and recreate instead.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_venture_event', clientId: extra.authInfo?.clientId });

      const result = await updateVentureEvent({
        userId,
        eventId: args.eventId,
        eventDate: args.eventDate,
        grossAmount: args.grossAmount,
        navAfter: args.navAfter,
        quantityPct: args.quantityPct,
        notes: args.notes,
        gpCarryAmount: args.gpCarryAmount,
        lpNetAmount: args.lpNetAmount,
        resetOverrides: args.resetOverrides,
      });

      return jsonContent({ data: result });
    },
  );
}
