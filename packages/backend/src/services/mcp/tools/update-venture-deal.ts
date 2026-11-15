import { recordId } from '@common/lib/zod/custom-types';
import { updateVentureDealBodyShape, updateVentureDealBodySchema } from '@controllers/venture/schemas';
import { updateVentureDeal } from '@services/venture/deals/update.service';

import { defineTool } from '../define-tool';

export const updateVentureDealTool = defineTool({
  name: 'update_venture_deal',
  toolset: 'ventures',
  access: 'write',
  description:
    'Update a venture deal. Only provided fields change. Once any event exists on the deal, the terms (principal, entryFee, entryFeePct, carryPct, hurdlePct, investmentDate, currencyCode) are locked — changing them would silently stale the carry math. Delete the events first if the user needs to fix terms. Status can be overridden manually (auto-progression normally derives it from events). Fee percentages are decimal fractions in [0,1].',
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
    name: updateVentureDealBodyShape.name.describe('New deal name'),
    platformId: updateVentureDealBodyShape.platformId.describe('Move to a different platform (or null to clear)'),
    spvSubtype: updateVentureDealBodyShape.spvSubtype.describe('New SPV subtype'),
    targetCompany: updateVentureDealBodyShape.targetCompany.describe('New target company name'),
    currencyCode: updateVentureDealBodyShape.currencyCode.describe('New currency code (locked once events exist)'),
    status: updateVentureDealBodyShape.status.describe('Override the deal status manually'),
    principal: updateVentureDealBodyShape.principal.describe('New principal (locked once events exist)'),
    entryFee: updateVentureDealBodyShape.entryFee.describe('New entry fee amount (locked once events exist)'),
    entryFeePct: updateVentureDealBodyShape.entryFeePct.describe(
      'New entry fee fraction in [0,1] (locked once events exist)',
    ),
    mgmtFeePct: updateVentureDealBodyShape.mgmtFeePct.describe('New management fee fraction in [0,1]'),
    carryPct: updateVentureDealBodyShape.carryPct.describe('New carry fraction in [0,1] (locked once events exist)'),
    hurdlePct: updateVentureDealBodyShape.hurdlePct.describe('New hurdle fraction in [0,1] (locked once events exist)'),
    investmentDate: updateVentureDealBodyShape.investmentDate.describe(
      'New investment date (locked once events exist)',
    ),
    expectedExitDate: updateVentureDealBodyShape.expectedExitDate.describe('New expected exit date (or null to clear)'),
    notes: updateVentureDealBodyShape.notes.describe('New notes (or null to clear)'),
  },
  // The at-least-one-field rule spans fields, so it runs on the REST body schema.
  validate: ({ args: { dealId, ...fields } }) => ({ dealId, ...updateVentureDealBodySchema.parse(fields) }),
  run: ({ userId, args }) => updateVentureDeal({ userId, ...args }),
});
