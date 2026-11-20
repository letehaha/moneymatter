import { recordId } from '@common/lib/zod/custom-types';
import { listAttachments } from '@services/attachments/attachments.service';

import { defineTool } from '../define-tool';

export const listTransactionAttachmentsTool = defineTool({
  name: 'list_transaction_attachments',
  toolset: 'core',
  access: 'read',
  description:
    'List the files attached to a transaction (receipts, invoices): id, filename, mimeType, size in bytes and upload time. File bytes are not returned. Use the id with delete_attachment; create_attachment_upload_url adds files.',
  input: {
    transactionId: recordId().describe('ID of the transaction'),
  },
  run: async ({ userId, args }) => {
    const attachments = await listAttachments({ userId, transactionId: args.transactionId });

    return attachments.map((attachment) => ({
      id: attachment.id,
      transactionId: attachment.transactionId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
    }));
  },
});
