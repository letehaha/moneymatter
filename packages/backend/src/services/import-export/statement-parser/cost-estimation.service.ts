/**
 * Cost estimation for statement extraction
 */
import type { StatementCostEstimate, StatementFileType } from '@bt/shared/types';
import { AI_FEATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import {
  estimateModelCostUsd,
  resolveEstimationPrelude,
  resolveTokenLimit,
} from '@services/import-export/core/cost-estimation';

import {
  STATEMENT_EXTRACTION_SYSTEM_PROMPT,
  createImageExtractionPrompt,
  createTextExtractionPrompt,
} from './extraction-prompt';
import type { StatementContent } from './prepare-statement-content';
import { estimateTokenCount } from './text-extractor';

// ponytail: flat per-image guess; providers bill images by pixel count, each in its own way.
const IMAGE_INPUT_TOKENS = 1600;

/** Average output tokens per transaction (estimated) */
const TOKENS_PER_TRANSACTION = 50;

/** Estimated minimum transactions per page */
const MIN_TRANSACTIONS_PER_PAGE = 5;

/** Estimated maximum transactions per page */
const MAX_TRANSACTIONS_PER_PAGE = 30;

interface CostEstimationParams {
  userId: number;
  content: StatementContent;
  pageCount: number;
  fileType: StatementFileType;
}

interface CostEstimationError {
  code: 'NO_AI_CONFIGURED' | 'TOKEN_LIMIT_EXCEEDED';
  message: string;
  details?: string;
}

type CostEstimationResultType =
  | { success: true; estimate: StatementCostEstimate }
  | { success: false; error: CostEstimationError };

/**
 * Estimate the cost of extracting transactions from a statement file
 */
export async function estimateExtractionCost({
  userId,
  content,
  pageCount,
  fileType,
}: CostEstimationParams): Promise<CostEstimationResultType> {
  const prelude = await resolveEstimationPrelude({ userId, feature: AI_FEATURE.statementParsing });

  if (!prelude.ok) {
    return { success: false, error: prelude.error };
  }

  const { aiConfig, modelProfile } = prelude;

  const systemPromptTokens = estimateTokenCount({ text: STATEMENT_EXTRACTION_SYSTEM_PROMPT });
  const userPromptTokens =
    content.kind === 'text'
      ? estimateTokenCount({ text: createTextExtractionPrompt({ text: content.text }) })
      : estimateTokenCount({ text: createImageExtractionPrompt({ today: 'YYYY-MM-DD' }) }) + IMAGE_INPUT_TOKENS;
  const estimatedInputTokens = systemPromptTokens + userPromptTokens;

  // Estimate output tokens based on expected number of transactions
  // Conservative estimate: 15 transactions per page on average
  const estimatedTransactions = pageCount * ((MIN_TRANSACTIONS_PER_PAGE + MAX_TRANSACTIONS_PER_PAGE) / 2);
  const metadataTokens = 100; // For metadata CSV structure
  const estimatedOutputTokens = estimatedTransactions * TOKENS_PER_TRANSACTION + metadataTokens;

  const tokenLimit = resolveTokenLimit({ modelProfile, estimatedInputTokens });

  if (tokenLimit.exceeded) {
    return {
      success: false,
      error: {
        code: 'TOKEN_LIMIT_EXCEEDED',
        message: t({
          key: 'statementParser.tokenLimitExceeded',
          variables: {
            estimatedTokens: estimatedInputTokens,
            maxTokens: tokenLimit.maxInputTokens,
            modelName: tokenLimit.modelName,
          },
        }),
        details: t({
          key: 'statementParser.tokenLimitExceededSuggestion',
          variables: { maxTransactions: Math.floor(tokenLimit.maxInputTokens / 100) },
        }),
      },
    };
  }

  return {
    success: true,
    estimate: {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: estimateModelCostUsd({
        profile: modelProfile,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
      }),
      modelId: aiConfig.modelId,
      modelName: modelProfile.name,
      usingUserKey: aiConfig.usingUserKey,
      textExtraction: {
        success: true,
        characterCount: content.kind === 'text' ? content.text.length : 0,
        pageCount,
      },
      fileType,
    },
  };
}
