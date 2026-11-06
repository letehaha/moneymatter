import { recordId } from '@common/lib/zod/custom-types';
import { transferAdjustmentBodySchema } from '@controllers/investments/portfolios/schemas';
import { setTransferAdjustment } from '@services/investments/portfolios/transfers';

import { defineTool } from '../define-tool';
import { slimPortfolioTransferForMcp } from '../serializers';

export const setPortfolioTransferAdjustmentTool = defineTool({
  name: 'set_portfolio_transfer_adjustment',
  toolset: 'investments',
  access: 'write',
  description:
    'Flag a portfolio transfer as an adjustment, or clear the flag. An adjustment is a correction, not money the user put in, so it drops out of the investment contributions report. Only the flag changes: the amount, date and portfolio balance stay as they are. Returns the transfer.',
  input: {
    transferId: recordId().describe('Portfolio transfer ID (from list_portfolio_transfers)'),
    isAdjustment: transferAdjustmentBodySchema.shape.isAdjustment.describe(
      'true to treat the transfer as an adjustment (a correction that is not a contribution); false to count it as a contribution',
    ),
  },
  run: async ({ userId, args }) => {
    const transfer = await setTransferAdjustment({
      userId,
      transferId: args.transferId,
      isAdjustment: args.isAdjustment,
    });

    return slimPortfolioTransferForMcp(transfer);
  },
});
