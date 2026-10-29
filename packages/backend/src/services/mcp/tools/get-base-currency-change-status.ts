import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBaseCurrencyChangeStatus } from '@services/currencies/base-currency-change-status.service';

import { getUserId, jsonContent } from './helpers';

export function registerGetBaseCurrencyChangeStatus(server: McpServer) {
  server.registerTool(
    'get_base_currency_change_status',
    {
      description:
        'Get the state of the base-currency change started by change_base_currency: idle (none ran or it aged out), queued, running (with its current step), completed (with the counts of what was recalculated) or failed (with the reason). While it is queued or running, other edits are refused.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_base_currency_change_status', clientId: extra.authInfo?.clientId });

      const status = await getBaseCurrencyChangeStatus({ userId });
      return jsonContent({ data: status });
    },
  );
}
