import type { ChatAttachment } from '@bt/shared/types';
import type ChatAttachments from '@models/chat-attachments.model';

import { buildAttachmentExcerpt, isAttachmentTextTruncated } from './attachment-text';

export const toChatAttachment = ({ attachment }: { attachment: ChatAttachments }): ChatAttachment => ({
  id: attachment.id,
  threadId: attachment.threadId,
  messageId: attachment.messageId,
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  kind: attachment.kind,
  sizeBytes: attachment.sizeBytes,
  pageCount: attachment.pageCount,
  excerpt: buildAttachmentExcerpt({ text: attachment.extractedText }),
  textTruncated: isAttachmentTextTruncated({ text: attachment.extractedText }),
  createdAt: attachment.createdAt.toISOString(),
});
