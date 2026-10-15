import { createController } from '@controllers/helpers/controller-factory';
import { UnexpectedError } from '@js/errors';
import { estimateInvestmentExtractionCost } from '@services/import-export/investment-transactions-parser';
import {
  extractTextFromFile,
  resolveTextExtractionSuggestion,
  validateFileBuffer,
} from '@services/import-export/statement-parser';
import { z } from 'zod';

/**
 * Estimate the AI cost of extracting investment transactions from a file.
 * Mirrors the statement-parser cost-estimate flow: validate → text-extract →
 * tokenise → look up pricing. Surfaced to the UI before the user pays for
 * the actual extraction.
 */
export const estimateCostController = createController(
  z.object({
    body: z.object({
      fileBase64: z.string().min(1, 'File content is required'),
    }),
  }),
  async ({ user, body }) => {
    const { fileBase64 } = body;

    const rawBuffer = Buffer.from(fileBase64, 'base64');
    const validation = validateFileBuffer({ buffer: rawBuffer });
    if (!validation.valid) {
      throw new UnexpectedError({ message: validation.error.message });
    }

    const textResult = await extractTextFromFile({
      buffer: validation.fileBuffer,
      fileType: validation.fileType,
    });

    if (!textResult.success) {
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
          fileType: validation.fileType,
          suggestion: resolveTextExtractionSuggestion({
            fileType: validation.fileType,
            errorCode: textResult.errorCode,
          }),
        },
      };
    }

    const costResult = await estimateInvestmentExtractionCost({
      userId: user.id,
      text: textResult.text!,
      pageCount: textResult.pageCount!,
      fileType: validation.fileType,
    });

    if (!costResult.success) {
      if (costResult.error.code === 'TOKEN_LIMIT_EXCEEDED') {
        return {
          data: {
            success: false,
            error: costResult.error,
            textExtraction: {
              success: true,
              characterCount: textResult.text!.length,
              pageCount: textResult.pageCount!,
            },
            fileType: validation.fileType,
            suggestion: costResult.error.details,
          },
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
