import { recordId } from '@common/lib/zod/custom-types';
import { removePayeeIgnoredName } from '@services/payees';

import { defineTool } from '../define-tool';

export const unignorePayeeNameTool = defineTool({
  name: 'unignore_payee_name',
  toolset: 'automations',
  access: 'write',
  description:
    'Remove a name from the ignored list, so imports and syncs may turn it into a payee again. Payees and transactions are not changed.',
  input: {
    ignoredNameId: recordId().describe('Id of the ignored-list row (from get_ignored_payee_names).'),
  },
  run: async ({ userId, args }) => {
    await removePayeeIgnoredName({ userId, id: args.ignoredNameId });
    return { deleted: true, ignoredNameId: args.ignoredNameId };
  },
});
