import { STATEMENT_IMAGE_MAX_BYTES, type StatementFileType } from '@bt/shared/types';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';

import { type StatementImageMediaType, validateFileBuffer } from './file-validator';
import { extractTextFromFile } from './text-extractor';

export type StatementContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: Buffer; mediaType: StatementImageMediaType };

type PreparedStatement =
  | { success: true; fileType: StatementFileType; content: StatementContent; pageCount: number }
  | {
      success: false;
      fileType: StatementFileType;
      textResult: Awaited<ReturnType<typeof extractTextFromFile>>;
    };

/**
 * Validates an upload and reads it into what the model is sent. A failed text read is
 * returned rather than thrown, because estimate and extract answer it differently.
 */
export async function prepareStatementContent({
  buffer,
  password,
}: {
  buffer: Buffer;
  password?: string;
}): Promise<PreparedStatement> {
  const validation = validateFileBuffer({ buffer, allowImages: true });
  if (!validation.valid) throw new UnexpectedError({ message: validation.error.message });

  if (validation.fileType === 'image') {
    // Never decoded server-side to shrink it: a corrupt file can crash the native decoder.
    if (validation.fileBuffer.length > STATEMENT_IMAGE_MAX_BYTES) {
      throw new ValidationError({ message: t({ key: 'statementParser.imageTooLarge' }) });
    }

    return {
      success: true,
      fileType: 'image',
      content: { kind: 'image', image: validation.fileBuffer, mediaType: validation.imageMediaType },
      pageCount: 1,
    };
  }

  const textResult = await extractTextFromFile({
    buffer: validation.fileBuffer,
    fileType: validation.fileType,
    password,
  });
  if (!textResult.success) return { success: false, fileType: validation.fileType, textResult };

  return {
    success: true,
    fileType: validation.fileType,
    content: { kind: 'text', text: textResult.text! },
    pageCount: textResult.pageCount!,
  };
}
