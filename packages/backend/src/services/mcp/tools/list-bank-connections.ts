import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConnectionDetails } from '@services/bank-data-providers/connection/get-connection-details';
import { listUserConnections } from '@services/bank-data-providers/connection/list-user-connections';
import { z } from 'zod';

import { presentBankConnection, presentBankConnectionDetails } from './bank-connection-output';
import { getUserId, jsonContent } from './helpers';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const inputSchema = {
  connectionId: recordId()
    .optional()
    .describe(
      'Bank connection ID (from this tool). Omit to list every connection; pass it to read one with its accounts',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `List: how many connections to return, newest first, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT}). Ignored when connectionId is set`,
    ),
};

export function registerListBankConnections(server: McpServer) {
  server.registerTool(
    'list_bank_connections',
    {
      description:
        'List the bank connections of the signed-in user (a bank or data provider linked to MoneyMatter), or read one with connectionId. A connection has id, providerType, providerName, bankName, isActive, lastSyncAt, accountsCount and createdAt. Returns { connections, total } (newest first; total counts the connections before limit). Reading one returns { connection } with its provider name and features, its accounts (id, name, currentBalance as a decimal, currencyCode, type, currencyFallback), the consent window (validFrom, validUntil, daysRemaining, isExpired, isExpiringSoon) and deactivationReason when it was switched off. Credentials, tokens and provider sessions are never returned. Read-only: connecting, reconnecting, renaming and disconnecting a bank is done in the app. For per-account sync results use get_bank_sync_status.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_bank_connections', clientId: extra.authInfo?.clientId });

      if (args.connectionId) {
        const connection = await getConnectionDetails({ connectionId: args.connectionId, userId });
        return jsonContent({ data: { connection: presentBankConnectionDetails({ connection }) } });
      }

      const connections = await listUserConnections({ userId });
      return jsonContent({
        data: {
          connections: connections
            .slice(0, args.limit ?? DEFAULT_LIMIT)
            .map((connection) => presentBankConnection({ connection })),
          total: connections.length,
        },
      });
    },
  );
}
