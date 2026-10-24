import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUserActiveImportBatchDeleteStatus } from '@services/import-export/delete-batch-queue';

import { getUserId, jsonContent } from './helpers';
import { presentImportBatchDeleteStatus } from './import-batch-output';

export function registerGetImportBatchDeleteStatus(server: McpServer) {
  server.registerTool(
    'get_import_batch_delete_status',
    {
      description:
        'Read the state of the latest background import batch delete of the signed-in user, the job delete_import_batch starts for a batch above 1000 rows. Returns { state } with state idle (no job), queued or running (with jobId), completed (jobId and deletedCount) or failed (jobId and error). While a job is queued or running, writes are blocked. Read-only.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_import_batch_delete_status', clientId: extra.authInfo?.clientId });

      const status = await getUserActiveImportBatchDeleteStatus({ userId });

      return jsonContent({ data: presentImportBatchDeleteStatus({ status }) });
    },
  );
}
