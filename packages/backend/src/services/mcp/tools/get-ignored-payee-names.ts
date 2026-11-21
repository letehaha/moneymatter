import { listPayeeIgnoredNames } from '@services/payees';

import { defineTool } from '../define-tool';
import { presentIgnoredName } from './payee-output';

export const getIgnoredPayeeNamesTool = defineTool({
  name: 'get_ignored_payee_names',
  toolset: 'automations',
  access: 'read',
  description:
    'List the names on the ignored list, newest first. A name on it is never turned into a payee automatically when transactions are imported or synced. Each row has id, normalizedName, rawSample and createdAt. Use the id with unignore_payee_name.',
  run: async ({ userId }) => {
    const rows = await listPayeeIgnoredNames({ userId });
    return rows.map((row) => presentIgnoredName({ row }));
  },
});
