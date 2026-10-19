/**
 * Cost estimation for investment transactions extraction. Same math as
 * statement-parser's cost estimator — different prompt + different output
 * shape, but token counts come from the same tokeniser.
 */
import { AI_FEATURE, type StatementCostEstimate, type StatementFileType } from '@bt/shared/types';
import { t } from '@i18n/index';
import {
  estimateModelCostUsd,
  resolveEstimationPrelude,
  resolveTokenLimit,
} from '@services/import-export/core/cost-estimation';
import { estimateTokenCount } from '@services/import-export/statement-parser/text-extractor';

import { createTextExtractionPrompt, getSystemPrompt } from './extraction-prompt';

/** Average output tokens per parsed transaction row. CSV is dense — 9 columns,
 * mostly short numbers — so this is conservative. */
const TOKENS_PER_TRANSACTION = 40;
const MIN_TRANSACTIONS_PER_PAGE = 5;
const MAX_TRANSACTIONS_PER_PAGE = 30;

interface CostEstimationParams {
  userId: number;
  text: string;
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

export async function estimateInvestmentExtractionCost({
  userId,
  text,
  pageCount,
  fileType,
}: CostEstimationParams): Promise<CostEstimationResultType> {
  const prelude = await resolveEstimationPrelude({ userId, feature: AI_FEATURE.investmentTransactionsParsing });

  if (!prelude.ok) {
    return { success: false, error: prelude.error };
  }

  const { aiConfig, modelProfile } = prelude;

  const systemPrompt = getSystemPrompt();
  const systemPromptTokens = estimateTokenCount({ text: systemPrompt });
  const userPromptTokens = estimateTokenCount({ text: createTextExtractionPrompt({ text }) });
  const estimatedInputTokens = systemPromptTokens + userPromptTokens;

  const estimatedTransactions = pageCount * ((MIN_TRANSACTIONS_PER_PAGE + MAX_TRANSACTIONS_PER_PAGE) / 2);
  const estimatedOutputTokens = Math.ceil(estimatedTransactions * TOKENS_PER_TRANSACTION);

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
        details: t({ key: 'investments.import.tokenLimitExceededSuggestion' }),
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
        characterCount: text.length,
        pageCount,
      },
      fileType,
    },
  };
}
