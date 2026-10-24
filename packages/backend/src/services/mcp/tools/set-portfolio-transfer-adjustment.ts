import { recordId } from '@common/lib/zod/custom-types';
import { transferAdjustmentBodySchema } from '@controllers/investments/portfolios/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setTransferAdjustment } from '@services/investments/portfolios/transfers';

import { slimPortfolioTransferForMcp } from '../serializers';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transferId: recordId().describe('Portfolio transfer ID (from list_portfolio_transfers)'),
  isAdjustment: transferAdjustmentBodySchema.shape.isAdjustment.describe(
    'true to treat the transfer as an adjustment (a correction that is not a contribution); false to count it as a contribution',
  ),
};

export function registerSetPortfolioTransferAdjustment(server: McpServer) {
  server.registerTool(
    'set_portfolio_transfer_adjustment',
    {
      description:
        'Flag a portfolio transfer as an adjustment, or clear the flag. An adjustment is a correction, not money the user put in, so it drops out of the investment contributions report. Only the flag changes: the amount, date and portfolio balance stay as they are. Returns the transfer. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_portfolio_transfer_adjustment', clientId: extra.authInfo?.clientId });

      const transfer = await setTransferAdjustment({
        userId,
        transferId: args.transferId,
        isAdjustment: args.isAdjustment,
      });

      return jsonContent({ data: slimPortfolioTransferForMcp(transfer) });
    },
  );
}
