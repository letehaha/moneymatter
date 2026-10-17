import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE } from '@bt/shared/types/venture';
import { dateString, decimalString, isoCurrencyCode, percentageFraction, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateVentureDeal } from '@services/venture/deals/update.service';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
  name: z.string().optional().describe('New deal name'),
  platformId: recordId().nullable().optional().describe('Move to a different platform (or null to clear)'),
  spvSubtype: z.nativeEnum(VENTURE_SPV_SUBTYPE).nullable().optional().describe('New SPV subtype'),
  targetCompany: z.string().nullable().optional().describe('New target company name'),
  currencyCode: isoCurrencyCode().optional().describe('New currency code (locked once events exist)'),
  status: z.nativeEnum(VENTURE_DEAL_STATUS).optional().describe('Override the deal status manually'),
  principal: decimalString().optional().describe('New principal (locked once events exist)'),
  entryFee: decimalString().optional().describe('New entry fee amount (locked once events exist)'),
  entryFeePct: percentageFraction().optional().describe('New entry fee fraction in [0,1] (locked once events exist)'),
  mgmtFeePct: percentageFraction().optional().describe('New management fee fraction in [0,1]'),
  carryPct: percentageFraction().optional().describe('New carry fraction in [0,1] (locked once events exist)'),
  hurdlePct: percentageFraction().optional().describe('New hurdle fraction in [0,1] (locked once events exist)'),
  investmentDate: dateString().optional().describe('New investment date (locked once events exist)'),
  expectedExitDate: dateString().nullable().optional().describe('New expected exit date (or null to clear)'),
  notes: z.string().nullable().optional().describe('New notes (or null to clear)'),
};

export function registerUpdateVentureDeal(server: McpServer) {
  server.registerTool(
    'update_venture_deal',
    {
      description:
        'Update a venture deal. Only provided fields change. Once any event exists on the deal, the terms (principal, entryFee, entryFeePct, carryPct, hurdlePct, investmentDate, currencyCode) are locked — changing them would silently stale the carry math. Delete the events first if the user needs to fix terms. Status can be overridden manually (auto-progression normally derives it from events). Fee percentages are decimal fractions in [0,1].',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'update_venture_deal', clientId: extra.authInfo?.clientId });

      const deal = await updateVentureDeal({
        userId,
        dealId: args.dealId,
        name: args.name,
        platformId: args.platformId,
        spvSubtype: args.spvSubtype,
        targetCompany: args.targetCompany,
        currencyCode: args.currencyCode,
        status: args.status,
        principal: args.principal,
        entryFee: args.entryFee,
        entryFeePct: args.entryFeePct,
        mgmtFeePct: args.mgmtFeePct,
        carryPct: args.carryPct,
        hurdlePct: args.hurdlePct,
        investmentDate: args.investmentDate,
        expectedExitDate: args.expectedExitDate,
        notes: args.notes,
      });

      return jsonContent({ data: deal });
    },
  );
}
