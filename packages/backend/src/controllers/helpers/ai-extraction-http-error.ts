import { BadGateway, TooManyRequests, UnexpectedError, ValidationError } from '@js/errors';
import type { AIExtractionError } from '@services/import-export/core/ai-extraction-failure';

/**
 * The failure the client sees for each way an AI extraction step can end. A new code must be
 * placed here: the exhaustive switch fails the type check until it is.
 */
export const toAiExtractionHttpError = ({ error }: { error: AIExtractionError }) => {
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
      error.code satisfies never;
      return new UnexpectedError({ message: error.message });
  }
};
