/**
 * AI-powered statement extraction service
 */
import type {
  ExtractedMetadata,
  ExtractedTransaction,
  StatementExtractionResult,
  StatementFileType,
} from '@bt/shared/types';
import { AI_FEATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils';
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_OUTPUT_TRUNCATED_MESSAGE,
  aiCallGuards,
  createAIClient,
  describeMissingAiConfiguration,
  hitOutputCeiling,
} from '@services/ai';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { type AIExtractionError, resolveAiExtractionFailure } from '@services/import-export/core/ai-extraction-failure';
import { type ModelMessage, generateText } from 'ai';
import { format } from 'date-fns';

import {
  STATEMENT_EXTRACTION_SYSTEM_PROMPT,
  createImageExtractionPrompt,
  createTextExtractionPrompt,
  parseAIResponse,
} from './extraction-prompt';
import type { StatementContent } from './prepare-statement-content';

interface AIExtractionParams {
  userId: number;
  content: StatementContent;
  pageCount: number;
  fileType: StatementFileType;
  /** IANA timezone the user's "today" is read in; the server's own zone when absent or unknown. */
  timezone?: string;
}

function todayIn({ timezone }: { timezone?: string }): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return format(new Date(), 'yyyy-MM-dd');
  }
}

function buildUserMessage({ content, today }: { content: StatementContent; today: string }): ModelMessage {
  if (content.kind === 'text') {
    return { role: 'user', content: createTextExtractionPrompt({ text: content.text }) };
  }

  return {
    role: 'user',
    content: [
      { type: 'text', text: createImageExtractionPrompt({ today }) },
      { type: 'file', data: content.image, mediaType: content.mediaType },
    ],
  };
}

type AIExtractionResultType =
  | { success: true; result: StatementExtractionResult }
  | { success: false; error: AIExtractionError };

/**
 * Extract transactions from statement text using AI
 */
export async function extractTransactionsWithAI({
  userId,
  content,
  pageCount,
  fileType,
  timezone,
}: AIExtractionParams): Promise<AIExtractionResultType> {
  // Get AI client for statement parsing feature
  const aiClient = await createAIClient({
    userId,
    feature: AI_FEATURE.statementParsing,
  });

  if (!aiClient) {
    logger.info('[Statement Parser] AI extraction returned failure', { code: 'NO_AI_CONFIGURED', userId });

    return {
      success: false,
      error: {
        code: 'NO_AI_CONFIGURED',
        message: await describeMissingAiConfiguration({ userId }),
      },
    };
  }

  try {
    logger.info('[Statement Parser] Starting AI extraction', {
      modelId: aiClient.modelId,
      ...(content.kind === 'text' ? { textLength: content.text.length } : { imageBytes: content.image.length }),
    });

    const { abortSignal, maxRetries } = aiCallGuards({ provider: aiClient.provider });

    const {
      text: responseText,
      usage,
      finishReason,
    } = await generateText({
      model: aiClient.model,
      system: STATEMENT_EXTRACTION_SYSTEM_PROMPT,
      messages: [buildUserMessage({ content, today: todayIn({ timezone }) })],
      abortSignal,
      maxRetries,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    await trackAiUsage({ userId, feature: AI_FEATURE.statementParsing, aiClient, usage });

    logger.info('[Statement Parser] AI answered', { responseLength: responseText.length, usage, finishReason });

    // A truncated CSV still parses cleanly up to the cut, so without this the
    // transactions that never arrived would look exactly like transactions the
    // statement never had -- a wrong balance instead of an error.
    if (hitOutputCeiling({ finishReason, usage })) {
      logger.info('[Statement Parser] AI extraction returned failure', {
        code: 'OUTPUT_TRUNCATED',
        userId,
        outputTokens: usage?.outputTokens ?? 0,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        finishReason,
      });

      return {
        success: false,
        error: {
          code: 'OUTPUT_TRUNCATED',
          message: AI_OUTPUT_TRUNCATED_MESSAGE,
          details: `Generation stopped at the ${AI_MAX_OUTPUT_TOKENS}-token output limit (used ${usage?.outputTokens ?? 0}, finishReason: ${finishReason}).`,
        },
      };
    }

    // Parse AI response
    const parsed = parseAIResponse({ response: responseText });

    if (!parsed) {
      logger.info('[Statement Parser] AI extraction returned failure', {
        code: 'EXTRACTION_FAILED',
        userId,
        reason: 'unparseable-response',
        responseLength: responseText.length,
      });

      return {
        success: false,
        error: {
          code: 'EXTRACTION_FAILED',
          message: t({ key: 'statementParser.aiResponseUnparseable' }),
          details: responseText.slice(0, 500),
        },
      };
    }

    if (parsed.transactions.length === 0) {
      if (parsed.droppedRowCount > 0) {
        logger.info('[Statement Parser] AI extraction returned failure', {
          code: 'EXTRACTION_FAILED',
          userId,
          reason: 'all-rows-dropped',
          droppedRowCount: parsed.droppedRowCount,
        });

        return {
          success: false,
          error: {
            code: 'EXTRACTION_FAILED',
            message: t({ key: 'statementParser.allRowsDropped', variables: { count: parsed.droppedRowCount } }),
            details: responseText.slice(0, 500),
          },
        };
      }

      logger.info('[Statement Parser] AI extraction returned failure', {
        code: 'NO_TRANSACTIONS_FOUND',
        userId,
        contentKind: content.kind,
        pageCount,
        fileType,
      });

      return {
        success: false,
        error: {
          code: 'NO_TRANSACTIONS_FOUND',
          message: t({ key: 'statementParser.noTransactionsFound' }),
        },
      };
    }

    // Convert to our types
    const transactions: ExtractedTransaction[] = parsed.transactions.map((tx) => ({
      date: tx.date,
      description: tx.description,
      merchant: tx.merchant,
      amount: tx.amount,
      type: tx.type,
      balance: tx.balance ?? undefined,
      confidence: tx.confidence,
      originalAmount: tx.originalAmount,
      originalCurrencyCode: tx.originalCurrencyCode,
      externalReference: tx.externalReference,
    }));

    const metadata: ExtractedMetadata = {
      bankName: parsed.metadata.bankName ?? undefined,
      accountNumberLast4: parsed.metadata.accountNumberLast4 ?? undefined,
      statementPeriod: parsed.metadata.statementPeriod ?? undefined,
      currencyCode: parsed.metadata.currencyCode ?? undefined,
    };

    return {
      success: true,
      result: {
        transactions,
        metadata,
        pageCount,
        fileType,
        tokenCount: {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
        },
        droppedRowCount: parsed.droppedRowCount,
      },
    };
  } catch (error) {
    const failure = await resolveAiExtractionFailure({ userId, aiClient, error, logPrefix: '[Statement Parser]' });

    return { success: false, error: failure.error };
  }
}
