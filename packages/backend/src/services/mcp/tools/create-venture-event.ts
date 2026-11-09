import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { dateString, decimalString, recordId } from '@common/lib/zod/custom-types';
import { createVentureEvent } from '@services/venture/events/create.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const createVentureEventTool = defineTool({
  name: 'create_venture_event',
  toolset: 'ventures',
  access: 'write',
  description:
    "Record an event on a venture deal. The deal must already have an initial_investment before any other event type can be created (initial_investment must come first). Event date cannot precede the initial_investment date.\n\nRules per type (the schema is flat but the service enforces these — invalid combinations return a clear ValidationError):\n  • initial_investment: grossAmount is auto-derived from the deal's principal + entryFee — do NOT pass it. cashFlowMode must be 'linked' or 'out_of_wallet'.\n  • capital_call, fee_payment, distribution, capital_refund: require grossAmount. cashFlowMode must be 'linked' or 'out_of_wallet'.\n  • capital_refund: uninvested capital sent back by the vehicle (e.g. an SPV allocation fell through). Lowers cost basis instead of counting as a distribution — no carry, no DPI, no status change. Use distribution only for proceeds or principal returned from deployed capital.\n  • exit: requires grossAmount AND navAfter. cashFlowMode must be 'linked' or 'out_of_wallet'.\n  • nav_update, writedown: require navAfter. cashFlowMode must be 'none'.\n\nFor cashFlowMode='linked', the linked transactions are the bank-side cash; their sum may differ from the event's lpNetAmount (transfer fees), so record the statement amount as grossAmount. For cashFlowMode='out_of_wallet', no transactions are linked — the event amount is recorded but does NOT affect bank balances or cash-flow charts.\n\nCarry on distribution/exit is auto-computed (European waterfall by default). Pass `lpNetAmountOverride` / `gpCarryOverride` to override the computed values (e.g. when matching a GP's statement).",
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
    type: z.nativeEnum(VENTURE_EVENT_TYPE).describe('Event type'),
    eventDate: dateString().describe('Event date in YYYY-MM-DD'),
    cashFlowMode: z
      .nativeEnum(VENTURE_CASH_FLOW_MODE)
      .describe(
        'linked = tie to existing bank txs; out_of_wallet = record event only; none = required for nav_update / writedown',
      ),
    grossAmount: decimalString()
      .nullable()
      .optional()
      .describe(
        'Gross amount (decimal string). Required for capital_call, fee_payment, distribution, capital_refund, exit.',
      ),
    navAfter: decimalString()
      .nullable()
      .optional()
      .describe('Post-event NAV (decimal string). Required for nav_update, writedown, AND exit.'),
    quantityPct: decimalString()
      .nullable()
      .optional()
      .describe('Optional partial-exit quantity fraction in [0,1] (used for partial exits).'),
    transactionIds: z
      .array(recordId())
      .optional()
      .describe('Bank transaction ids to link. Required when cashFlowMode=linked; must NOT be provided otherwise.'),
    lpNetAmountOverride: decimalString()
      .nullable()
      .optional()
      .describe('Override the auto-computed lpNetAmount (distribution/exit only).'),
    gpCarryOverride: decimalString()
      .nullable()
      .optional()
      .describe('Override the auto-computed gpCarryAmount (distribution/exit only).'),
    notes: z.string().nullable().optional().describe('Free-text notes'),
  },
  run: ({ userId, args }) =>
    createVentureEvent({
      userId,
      dealId: args.dealId,
      type: args.type,
      eventDate: args.eventDate,
      cashFlowMode: args.cashFlowMode,
      grossAmount: args.grossAmount,
      navAfter: args.navAfter,
      quantityPct: args.quantityPct,
      transactionIds: args.transactionIds,
      lpNetAmountOverride: args.lpNetAmountOverride,
      gpCarryOverride: args.gpCarryOverride,
      notes: args.notes,
    }),
});
