import {
  ATTACHMENTS_MAX_PER_TRANSACTION,
  ATTACHMENT_FILENAME_HEADER,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_UPLOAD_TOKEN_HEADER,
  ATTACHMENT_UPLOAD_TOKEN_TTL_SECONDS,
} from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { API_PREFIX, BETTER_AUTH_BASE_URL } from '@root/config';
import { createAttachmentUploadToken } from '@services/attachments/attachments.service';

import { defineTool } from '../define-tool';

export const createAttachmentUploadUrlTool = defineTool({
  name: 'create_attachment_upload_url',
  toolset: 'core',
  access: 'write',
  // POST /transactions/:transactionId/attachments has no lock: attachments touch no amounts.
  lock: false,
  description:
    'Get a short-lived upload URL for attaching receipt/invoice files (JPEG, PNG, WebP, PDF) to a transaction. File bytes cannot be sent through MCP: POST each file as the raw request body to the returned url with the returned headers, plus the header named by filenameHeader set to the URI-encoded original filename of that file (e.g. via curl --data-binary). The URL works for multiple files until it expires. Requires a client that can make HTTP requests with local files.',
  input: {
    transactionId: recordId().describe('ID of the transaction to attach files to'),
  },
  run: async ({ userId, args }) => {
    const token = await createAttachmentUploadToken({ userId, transactionId: args.transactionId });
    const url = `${BETTER_AUTH_BASE_URL}${API_PREFIX}/transactions/${args.transactionId}/attachments`;

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        [ATTACHMENT_UPLOAD_TOKEN_HEADER]: token,
      },
      filenameHeader: ATTACHMENT_FILENAME_HEADER,
      expiresInSeconds: ATTACHMENT_UPLOAD_TOKEN_TTL_SECONDS,
      maxFileBytes: ATTACHMENT_MAX_FILE_BYTES,
      maxFilesPerTransaction: ATTACHMENTS_MAX_PER_TRANSACTION,
      allowedMimeTypes: ATTACHMENT_MIME_TYPES,
      curlExample: `curl -X POST '${url}' -H 'Content-Type: application/octet-stream' -H '${ATTACHMENT_UPLOAD_TOKEN_HEADER}: ${token}' -H '${ATTACHMENT_FILENAME_HEADER}: receipt.pdf' --data-binary @receipt.pdf`,
    };
  },
});
