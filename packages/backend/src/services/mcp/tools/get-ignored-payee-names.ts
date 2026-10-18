import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listPayeeIgnoredNames } from '@services/payees';

import { getUserId, jsonContent } from './helpers';
import { presentIgnoredName } from './payee-output';

export function registerGetIgnoredPayeeNames(server: McpServer) {
  server.registerTool(
    'get_ignored_payee_names',
    {
      description:
        'List the names on the ignored list, newest first. A name on it is never turned into a payee automatically when transactions are imported or synced. Each row has id, normalizedName, rawSample and createdAt. Use the id with unignore_payee_name.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_ignored_payee_names', clientId: extra.authInfo?.clientId });

      const rows = await listPayeeIgnoredNames({ userId });
      return jsonContent({ data: rows.map((row) => presentIgnoredName({ row })) });
    },
  );
}
