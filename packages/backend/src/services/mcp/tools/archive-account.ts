import { ACCOUNT_STATUSES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { updateAccount } from '@services/accounts.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const archiveAccountTool = defineTool({
  name: 'archive_account',
  toolset: 'core',
  access: 'write',
  description:
    'Archive or unarchive a user account. Archiving removes the account from groups and unlinks subscriptions. Set archived=false to restore an archived account to active status.',
  input: {
    accountId: recordId().describe('ID of the account to archive or unarchive.'),
    archived: z.boolean().describe('true to archive the account, false to unarchive (restore to active status).'),
  },
  run: ({ userId, args }) => {
    const status = args.archived ? ACCOUNT_STATUSES.archived : ACCOUNT_STATUSES.active;

    return updateAccount({
      id: args.accountId,
      userId,
      status,
    });
  },
});
