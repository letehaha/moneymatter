import {
  CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE,
  CHAT_ATTACHMENTS_PER_MESSAGE,
  CHAT_ATTACHMENT_MAX_BYTES,
} from '@bt/shared/types';

export interface ChatAttachmentProblem {
  key: string;
  params: Record<string, string | number>;
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * What the composer takes: images, PDFs, CSV and plain text. HEIC/HEIF is converted to JPEG in the browser
 * before upload, since the server never decodes images. The server checks the bytes again; this keeps the
 * obvious misses off the network.
 */
const SUPPORTED_EXTENSIONS = ['.pdf', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'] as const;
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** The value for the file picker's `accept`. */
export const CHAT_ATTACHMENT_ACCEPT = [...SUPPORTED_EXTENSIONS, ...SUPPORTED_MIME_TYPES].join(',');

const isSupported = ({ file }: { file: File }): boolean => {
  const name = file.name.toLowerCase();
  return (
    SUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension)) ||
    (SUPPORTED_MIME_TYPES as readonly string[]).includes(file.type)
  );
};

/**
 * Splits the files a user picked into the ones to upload and the reasons for the others. The limits
 * are the server's, counted with what the message holds already; a limit is reported once however
 * many files ran into it.
 */
export const planChatAttachments = ({
  current,
  incoming,
}: {
  current: Array<{ sizeBytes: number }>;
  incoming: File[];
}): { accepted: File[]; problems: ChatAttachmentProblem[] } => {
  const accepted: File[] = [];
  const problems: ChatAttachmentProblem[] = [];
  const reported = new Set<string>();
  const report = ({ problem, once }: { problem: ChatAttachmentProblem; once: boolean }) => {
    if (once && reported.has(problem.key)) return;
    reported.add(problem.key);
    problems.push(problem);
  };

  let count = current.length;
  let totalBytes = current.reduce((sum, { sizeBytes }) => sum + sizeBytes, 0);

  for (const file of incoming) {
    if (!isSupported({ file })) {
      report({ problem: { key: 'chat.composer.attachments.unsupported', params: { name: file.name } }, once: false });
    } else if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      report({
        problem: {
          key: 'chat.composer.attachments.tooLarge',
          params: { name: file.name, max: CHAT_ATTACHMENT_MAX_BYTES / BYTES_PER_MEGABYTE },
        },
        once: false,
      });
    } else if (count >= CHAT_ATTACHMENTS_PER_MESSAGE) {
      report({
        problem: { key: 'chat.composer.attachments.tooMany', params: { max: CHAT_ATTACHMENTS_PER_MESSAGE } },
        once: true,
      });
    } else if (totalBytes + file.size > CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE) {
      report({
        problem: {
          key: 'chat.composer.attachments.totalTooLarge',
          params: { max: CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE / BYTES_PER_MEGABYTE },
        },
        once: true,
      });
    } else {
      accepted.push(file);
      count += 1;
      totalBytes += file.size;
    }
  }

  return { accepted, problems };
};

/** Whether the browser should decode and re-encode the file before upload: HEIC/HEIF, or any large image. */
export const isImageFile = ({ file }: { file: File }): boolean =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
