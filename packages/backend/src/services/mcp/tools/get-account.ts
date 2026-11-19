import { recordId } from '@common/lib/zod/custom-types';
import { getAccountById } from '@services/accounts.service';
import { getAccountTransactionCount } from '@services/accounts/transaction-count';

import { defineTool } from '../define-tool';
import { presentAccount } from './account-output';

export const getAccountTool = defineTool({
  name: 'get_account',
  toolset: 'core',
  access: 'read',
  description:
    'Read one account: balances (original and base currency), opening balance, credit limit, category, status, bank link (bankSeamAt: for an account linked to a bank later, the start of the link day; hand-entered transactions before it stay editable) and logo, plus transactionCount, the number of transactions the account holds (null for an account shared with the user). Use it before update_account or delete_account.',
  input: {
    accountId: recordId().describe('ID of the account to read.'),
  },
  run: async ({ userId, args }) => {
    const account = await getAccountById({ userId, id: args.accountId });
    const detail = presentAccount({ account });

    // The count is owner-scoped, as in REST: a share recipient can read the account but
    // cannot delete it.
    const isOwner = account?.userId === userId;
    const transactionCount = isOwner ? await getAccountTransactionCount({ userId, accountId: args.accountId }) : null;

    return { ...detail, transactionCount };
  },
});
