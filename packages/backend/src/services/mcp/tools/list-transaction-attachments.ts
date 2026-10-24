import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listAttachments } from '@services/attachments/attachments.service';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of the transaction'),
};

export function registerListTransactionAttachments(server: McpServer) {
  server.registerTool(
    'list_transaction_attachments',
    {
      description:
        'List the files attached to a transaction (receipts, invoices): id, filename, mimeType, size in bytes and upload time. File bytes are not returned. Use the id with delete_attachment; create_attachment_upload_url adds files.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_transaction_attachments', clientId: extra.authInfo?.clientId });

      const attachments = await listAttachments({ userId, transactionId: args.transactionId });

      return jsonContent({
        data: attachments.map((attachment) => ({
          id: attachment.id,
          transactionId: attachment.transactionId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: attachment.createdAt,
        })),
      });
    },
  );
}
