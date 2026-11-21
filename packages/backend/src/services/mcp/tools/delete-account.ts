import { recordId } from '@common/lib/zod/custom-types';
import { deleteAccountById } from '@services/accounts.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteAccountTool = defineTool({
  name: 'delete_account',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete an account together with all its transactions. Irreversible: call get_account first and read its transactionCount. To keep the history, use archive_account instead.',
  input: {
    accountId: recordId().describe('ID of the account to delete.'),
    removePortfolioTransfers: z
      .boolean()
      .optional()
      .describe(
        'Also remove the portfolio transfers that touch this account. Without it, an account with portfolio transfers is refused.',
      ),
  },
  run: async ({ userId, args }) => {
    await deleteAccountById({
      id: args.accountId,
      userId,
      removePortfolioTransfers: args.removePortfolioTransfers,
    });

    return { deleted: true, accountId: args.accountId };
  },
});
