import { recordId } from '@common/lib/zod/custom-types';
import { unlinkTransactionFromPortfolio } from '@services/investments/portfolios/transfers';

import { defineTool } from '../define-tool';

export const unlinkTransactionFromPortfolioTool = defineTool({
  name: 'unlink_transaction_from_portfolio',
  toolset: 'investments',
  access: 'write',
  description:
    'Remove the portfolio link from a transaction: deletes the portfolio transfer, reverses the portfolio cash balance change, and restores the transaction to a regular income/expense. Succeeds even if the transaction has no portfolio link.',
  input: {
    transactionId: recordId().describe('ID of the transaction currently linked to a portfolio'),
  },
  run: ({ userId, args }) =>
    unlinkTransactionFromPortfolio({
      userId,
      transactionId: args.transactionId,
    }),
});
