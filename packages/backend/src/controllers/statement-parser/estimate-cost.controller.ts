import type { StatementCostEstimateFailure } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { UnexpectedError } from '@js/errors';
import {
  estimateExtractionCost,
  prepareStatementContent,
  resolveTextExtractionSuggestion,
} from '@services/import-export/statement-parser';
import { z } from 'zod';

import { documentPasswordSchema } from './shared-schemas';

/**
 * Estimate the cost of extracting transactions from a statement file
 *
 * Expects file as base64 in request body
 * Supports PDF, CSV, TXT and image files
 */
export const estimateCostController = createController(
  z.object({
    body: z.object({
      /** Base64 encoded file */
      fileBase64: z.string().min(1, t({ key: 'statementParser.fileContentRequired' })),
      password: documentPasswordSchema,
    }),
  }),
  async ({ user, body }) => {
    const { fileBase64, password } = body;

    const prepared = await prepareStatementContent({ buffer: Buffer.from(fileBase64, 'base64'), password });

    if (!prepared.success) {
      const { fileType, textResult } = prepared;
      // Text extraction failed
      return {
        data: {
          success: false,
          textExtraction: {
            success: false,
            characterCount: textResult.text?.length ?? 0,
            pageCount: textResult.pageCount ?? 1,
            error: textResult.error,
            errorCode: textResult.errorCode,
          },
          fileType,
          suggestion: resolveTextExtractionSuggestion({ fileType, errorCode: textResult.errorCode }),
        } satisfies StatementCostEstimateFailure,
      };
    }

    const { content, pageCount, fileType } = prepared;
    const costResult = await estimateExtractionCost({ userId: user.id, content, pageCount, fileType });

    if (!costResult.success) {
      // Check if it's a token limit error
      if (costResult.error.code === 'TOKEN_LIMIT_EXCEEDED') {
        return {
          data: {
            success: false,
            error: costResult.error,
            textExtraction: {
              success: true,
              characterCount: content.kind === 'text' ? content.text.length : 0,
              pageCount,
            },
            fileType,
            suggestion: costResult.error.details ?? costResult.error.message,
          } satisfies StatementCostEstimateFailure,
        };
      }

      throw new UnexpectedError({
        message: costResult.error.message,
      });
    }

    return {
      data: costResult.estimate,
    };
  },
);
