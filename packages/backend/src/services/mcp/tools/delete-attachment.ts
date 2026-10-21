import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteAttachment } from '@services/attachments/attachments.service';

import { getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  attachmentId: recordId().describe('ID of the attachment to delete (from list_transaction_attachments)'),
};

export function registerDeleteAttachment(server: McpServer) {
  server.registerTool(
    'delete_attachment',
    {
      description:
        'Permanently delete a file attached to a transaction. Irreversible. Find attachment ids with list_transaction_attachments. Needs a plan that includes attachments. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      // DELETE /attachments/:id has no base-currency lock: attachments touch no amounts.
      await requireFeature({ userId, feature: FEATURES.attachments });
      trackMcpToolUsed({ userId, tool: 'delete_attachment', clientId: extra.authInfo?.clientId });

      await deleteAttachment({ userId, id: args.attachmentId });

      return jsonContent({ data: { deleted: true, attachmentId: args.attachmentId } });
    },
  );
}
