import { recordId } from '@common/lib/zod/custom-types';
import { unlinkAccountFromBankConnection } from '@services/accounts.service';

import { defineTool } from '../define-tool';
import { presentAccount } from './account-output';

export const unlinkAccountFromBankConnectionTool = defineTool({
  name: 'unlink_account_from_bank_connection',
  toolset: 'imports',
  access: 'write',
  description:
    'Disconnect a bank-connected account from its bank. The account becomes a manual account and keeps its whole transaction history, but stops syncing; the bank-side ids are kept only as history. Refused for an account that is not linked.',
  input: {
    accountId: recordId().describe('ID of the bank-connected account to unlink.'),
  },
  run: async ({ userId, args }) => {
    const account = await unlinkAccountFromBankConnection({ accountId: args.accountId, userId });

    return presentAccount({ account });
  },
});
