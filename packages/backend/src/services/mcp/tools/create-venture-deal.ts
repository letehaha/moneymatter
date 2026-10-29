import { VENTURE_CASH_FLOW_MODE } from '@bt/shared/types/venture';
import { recordId } from '@common/lib/zod/custom-types';
import { createVentureDealBodyShape } from '@controllers/venture/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createVentureDeal } from '@services/venture/deals/create.service';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: createVentureDealBodyShape.name.describe('Deal name (e.g. "SK 116 — Series A")'),
  currencyCode: createVentureDealBodyShape.currencyCode.describe('Three-letter ISO currency code (e.g. "USD")'),
  principal: createVentureDealBodyShape.principal.describe('Principal amount as a decimal string (e.g. "16000")'),
  investmentDate: createVentureDealBodyShape.investmentDate.describe('Investment date in YYYY-MM-DD'),
  platformId: createVentureDealBodyShape.platformId.describe('Optional platform id (from list_venture_platforms)'),
  vehicleType: createVentureDealBodyShape.vehicleType.describe('Vehicle type (default and only value: spv)'),
  spvSubtype: createVentureDealBodyShape.spvSubtype.describe('SPV subtype: single_company or multi_company'),
  targetCompany: createVentureDealBodyShape.targetCompany.describe('Free-text portfolio company name'),
  entryFeePct: createVentureDealBodyShape.entryFeePct.describe(
    'Entry fee as a decimal fraction in [0,1] (e.g. 0.085 for 8.5%).',
  ),
  entryFee: createVentureDealBodyShape.entryFee.describe(
    'Entry fee absolute amount in currency units. Defaults to principal * entryFeePct.',
  ),
  mgmtFeePct: createVentureDealBodyShape.mgmtFeePct.describe('Management fee as a decimal fraction in [0,1].'),
  carryPct: createVentureDealBodyShape.carryPct.describe('Carry as a decimal fraction in [0,1] (e.g. 0.2 for 20%).'),
  hurdlePct: createVentureDealBodyShape.hurdlePct.describe('Hurdle rate as a decimal fraction in [0,1].'),
  expectedExitDate: createVentureDealBodyShape.expectedExitDate.describe('Expected exit date (YYYY-MM-DD)'),
  notes: createVentureDealBodyShape.notes.describe('Free-text notes'),
  initialInvestment: z
    .object({
      cashFlowMode: z.enum([VENTURE_CASH_FLOW_MODE.linked, VENTURE_CASH_FLOW_MODE.out_of_wallet]),
      transactionIds: z
        .array(recordId())
        .optional()
        .describe('Required when cashFlowMode=linked. Sum of linked tx amounts must equal principal + entryFee.'),
    })
    .optional()
    .describe(
      'Optional: also create the initial_investment event in the same transaction. cashFlowMode=out_of_wallet records the investment without linking to bank txs (event amount is stored but not reflected on cash-flow charts).',
    ),
};

export function registerCreateVentureDeal(server: McpServer) {
  server.registerTool(
    'create_venture_deal',
    {
      description:
        'Create a venture deal (private/illiquid investment record). All monetary amounts are decimal strings in the deal\'s currency (e.g. "16000"). Fee percentages are decimal fractions in [0,1] — e.g. 0.085 for 8.5%, NOT 8.5. If platformId is provided, omitted fee fields are auto-filled from the platform\'s defaults. Optionally creates the initial_investment event in the same operation when `initialInvestment` is supplied. Only the SPV vehicle type is supported in v1.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_venture_deal', clientId: extra.authInfo?.clientId });

      const deal = await createVentureDeal({
        userId,
        name: args.name,
        currencyCode: args.currencyCode,
        principal: args.principal,
        investmentDate: args.investmentDate,
        platformId: args.platformId,
        vehicleType: args.vehicleType,
        spvSubtype: args.spvSubtype,
        targetCompany: args.targetCompany,
        entryFeePct: args.entryFeePct,
        entryFee: args.entryFee,
        mgmtFeePct: args.mgmtFeePct,
        carryPct: args.carryPct,
        hurdlePct: args.hurdlePct,
        expectedExitDate: args.expectedExitDate,
        notes: args.notes,
        initialInvestment: args.initialInvestment
          ? {
              cashFlowMode: args.initialInvestment.cashFlowMode as VENTURE_CASH_FLOW_MODE,
              transactionIds: args.initialInvestment.transactionIds,
            }
          : undefined,
      });

      return jsonContent({ data: deal });
    },
  );
}
