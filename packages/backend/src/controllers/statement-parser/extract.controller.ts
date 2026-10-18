import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { BadGateway, TooManyRequests, UnexpectedError, ValidationError } from '@js/errors';
import type { AIExtractionError } from '@services/import-export/core/ai-extraction-failure';
import {
  extractTransactionsWithAI,
  prepareStatementContent,
  resolveTextExtractionSuggestion,
} from '@services/import-export/statement-parser';
import { z } from 'zod';

import { documentPasswordSchema } from './shared-schemas';

/**
 * The failure the client sees for each way the AI step can end. A new code must be placed
 * here: the exhaustive switch fails the type check until it is.
 */
const toHttpError = ({ error }: { error: AIExtractionError }) => {
  switch (error.code) {
    // A different file, model or retry fixes these, so none of them is a server fault.
    case 'NO_AI_CONFIGURED':
    case 'NO_TRANSACTIONS_FOUND':
    case 'EXTRACTION_FAILED':
    case 'OUTPUT_TRUNCATED':
      return new ValidationError({ message: error.message });
    case 'RATE_LIMITED':
      return new TooManyRequests({ message: error.message });
    case 'AI_ERROR':
      return new BadGateway({ message: error.message });
    default:
      return error.code satisfies never;
  }
};

/**
 * Extract transactions from a statement file using AI
 *
 * Expects file as base64 in request body
 * Supports PDF, CSV, TXT and image files
 */
export const extractController = createController(
  z.object({
    body: z.object({
      /** Base64 encoded file */
      fileBase64: z.string().min(1, t({ key: 'statementParser.fileContentRequired' })),
      password: documentPasswordSchema,
      timezone: z.string().min(1).optional(),
    }),
  }),
  async ({ user, body }) => {
    const { fileBase64, password, timezone } = body;

    const prepared = await prepareStatementContent({ buffer: Buffer.from(fileBase64, 'base64'), password });

    if (!prepared.success) {
      const { fileType, textResult } = prepared;
      const message = resolveTextExtractionSuggestion({ fileType, errorCode: textResult.errorCode });

      // A missing or wrong password is fixed by the user retyping it, so it must
      // not read as a server fault (which would also page us through Sentry).
      if (textResult.errorCode === 'PASSWORD_REQUIRED' || textResult.errorCode === 'PASSWORD_INVALID') {
        throw new ValidationError({ message });
      }

      throw new UnexpectedError({ message });
    }

    const { content, pageCount, fileType } = prepared;
    const extractionResult = await extractTransactionsWithAI({
      userId: user.id,
      content,
      pageCount,
      fileType,
      timezone,
    });

    if (!extractionResult.success) {
      throw toHttpError({ error: extractionResult.error });
    }

    return {
      data: extractionResult.result,
    };
  },
);
