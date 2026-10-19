import { AI_PROVIDER } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils';
import {
  type AIClientResult,
  buildUnsupportedRequestMessage,
  classifyAiCallFailure,
  markConnectionRejected,
  markCustomEndpointUnreachable,
  markModelNotServed,
} from '@services/ai';

export interface AIExtractionError {
  code:
    | 'NO_AI_CONFIGURED'
    | 'AI_ERROR'
    | 'EXTRACTION_FAILED'
    | 'NO_TRANSACTIONS_FOUND'
    | 'RATE_LIMITED'
    | 'OUTPUT_TRUNCATED';
  message: string;
  details?: string;
}

/**
 * Turns a failed AI call into the error the parser answers with, and flags the failing
 * connection (dead endpoint, rejected key or missing model) so AI settings shows a way back.
 * Failures the user can fix are logged at info, so only unclassified ones reach Sentry.
 */
export async function resolveAiExtractionFailure({
  userId,
  aiClient,
  error,
  logPrefix,
}: {
  userId: number;
  aiClient: AIClientResult;
  error: unknown;
  logPrefix: string;
}): Promise<{ error: AIExtractionError; cause: Error }> {
  const { kind, cause } = classifyAiCallFailure({ error });
  const details = cause.message;
  const isCustomEndpoint = aiClient.provider === AI_PROVIDER.custom;

  // Only a custom endpoint gets flagged: a native provider going quiet is transient.
  if (kind === 'endpoint-down' && !isCustomEndpoint) {
    logger.info(`${logPrefix} AI provider connection failed`, { modelId: aiClient.modelId });

    return {
      error: { code: 'AI_ERROR', message: t({ key: 'importExport.aiTemporarilyUnavailable' }), details },
      cause,
    };
  }

  switch (kind) {
    case 'blocked-address': {
      // The outbound guard's own message names the address and why it was refused
      logger.info(`${logPrefix} custom endpoint address blocked: ${details}`, { modelId: aiClient.modelId });

      return { error: { code: 'AI_ERROR', message: cause.message }, cause };
    }

    case 'endpoint-down': {
      logger.info(`${logPrefix} AI endpoint did not answer`, { modelId: aiClient.modelId });
      const message = await markCustomEndpointUnreachable({ userId, aiClient });

      return { error: { code: 'AI_ERROR', message, details }, cause };
    }

    // The model is served, so the connection stays usable for requests it can take.
    case 'unsupported-request': {
      logger.info(`${logPrefix} AI model cannot take this request: ${details}`, { modelId: aiClient.modelId });
      const message = buildUnsupportedRequestMessage({ modelId: aiClient.modelId, reason: details });

      return { error: { code: 'AI_ERROR', message, details }, cause };
    }

    case 'model-not-found': {
      logger.info(`${logPrefix} Configured AI model is not served by the endpoint`, { modelId: aiClient.modelId });
      const message = await markModelNotServed({ userId, aiClient });

      return { error: { code: 'AI_ERROR', message, details }, cause };
    }

    case 'rate-limited': {
      logger.info(`${logPrefix} AI provider rate limit hit`, { modelId: aiClient.modelId });

      return {
        error: {
          code: 'RATE_LIMITED',
          message: t({ key: 'importExport.aiRateLimited' }),
          details,
        },
        cause,
      };
    }

    case 'auth': {
      logger.info(`${logPrefix} AI credentials rejected`, {
        modelId: aiClient.modelId,
        usingUserKey: aiClient.usingUserKey,
      });

      const message = await markConnectionRejected({ userId, aiClient });

      return { error: { code: 'AI_ERROR', message, details }, cause };
    }

    case 'temporary': {
      logger.info(`${logPrefix} AI provider temporarily unavailable`, { modelId: aiClient.modelId });

      return {
        error: { code: 'AI_ERROR', message: t({ key: 'importExport.aiTemporarilyUnavailable' }), details },
        cause,
      };
    }

    default: {
      logger.error({ message: `${logPrefix} AI extraction failed`, error: cause });

      return { error: { code: 'AI_ERROR', message: t({ key: 'importExport.aiExtractionFailed' }), details }, cause };
    }
  }
}
