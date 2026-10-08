/**
 * AI extraction for investment transactions.
 */
import { AI_FEATURE } from '@bt/shared/types';
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
import { generateText } from 'ai';

import {
  type AIParsedTransactionRow,
  createTextExtractionPrompt,
  getSystemPrompt,
  parseAIResponse,
} from './extraction-prompt';

interface AIExtractionParams {
  userId: number;
  text: string;
}

interface AIExtractionResult {
  rows: AIParsedTransactionRow[];
  tokenCount: { input: number; output: number };
  /** Lines the AI emitted that we couldn't parse. The controller surfaces a
   * warning when this is > 0 so the user knows the import is partial. */
  droppedRowCount: number;
}

type AIExtractionResultType =
  | { success: true; result: AIExtractionResult }
  | { success: false; error: AIExtractionError };

/**
 * Call the AI to extract structured transaction rows from arbitrary text.
 */
export async function extractInvestmentTransactionsWithAI({
  userId,
  text,
}: AIExtractionParams): Promise<AIExtractionResultType> {
  const aiClient = await createAIClient({
    userId,
    feature: AI_FEATURE.investmentTransactionsParsing,
  });

  if (!aiClient) {
    logger.info('[Investment Txn Parser] AI extraction returned failure', { code: 'NO_AI_CONFIGURED', userId });

    return {
      success: false,
      error: {
        code: 'NO_AI_CONFIGURED',
        message: await describeMissingAiConfiguration({ userId }),
      },
    };
  }

  try {
    const systemPrompt = getSystemPrompt();

    const { abortSignal, maxRetries } = aiCallGuards({ provider: aiClient.provider });

    const {
      text: responseText,
      usage,
      finishReason,
    } = await generateText({
      model: aiClient.model,
      system: systemPrompt,
      prompt: createTextExtractionPrompt({ text }),
      abortSignal,
      maxRetries,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    trackAiUsage({ userId, feature: AI_FEATURE.investmentTransactionsParsing, aiClient, usage });

    // Truncated rows parse as a complete-looking but short import, so refuse them.
    if (hitOutputCeiling({ finishReason, usage })) {
      logger.info('[Investment Txn Parser] AI extraction returned failure', {
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

    const { rows, droppedRowCount } = parseAIResponse({ response: responseText });

    if (rows.length === 0) {
      logger.info('[Investment Txn Parser] AI extraction returned failure', {
        code: 'NO_TRANSACTIONS_FOUND',
        userId,
        textLength: text.length,
        droppedRowCount,
      });

      return {
        success: false,
        error: {
          code: 'NO_TRANSACTIONS_FOUND',
          message: 'No transactions found in the file.',
          details: responseText.slice(0, 500),
        },
      };
    }

    return {
      success: true,
      result: {
        rows,
        droppedRowCount,
        tokenCount: {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
        },
      },
    };
  } catch (error) {
    const failure = await resolveAiExtractionFailure({
      userId,
      aiClient,
      error,
      logPrefix: '[Investment Txn Parser]',
    });

    return { success: false, error: failure.error };
  }
}
