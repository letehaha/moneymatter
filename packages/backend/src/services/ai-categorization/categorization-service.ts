import {
  AI_FEATURE,
  AI_PROVIDER,
  CATEGORIZATION_SKIP_REASON,
  CATEGORIZATION_SOURCE,
  type CATEGORIZATION_TRIGGER,
  SSE_EVENT_TYPES,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { trackAiCategorization } from '@js/utils/posthog';
import { getCategories } from '@models/categories.model';
import Payees from '@models/payees.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import {
  AIClientResult,
  AI_MAX_OUTPUT_TOKENS,
  type AiCallFailureKind,
  aiCallGuards,
  buildUnsupportedRequestMessage,
  classifyAiCallFailure,
  createAIClient,
  describeMissingAiConfiguration,
  hitOutputCeiling,
  markConnectionRejected,
  markCustomEndpointUnreachable,
  markModelNotServed,
} from '@services/ai';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { applyCategoryDefaultTagsOnAiCategorization } from '@services/categories/default-tags';
import { sseManager } from '@services/common/sse';
import { withTransaction } from '@services/common/with-transaction';
import { markConnectionValid } from '@services/user-settings/ai-connections';
import { getCustomInstructions } from '@services/user-settings/ai-custom-instructions';
import { generateText } from 'ai';

import { type CandidateWhere, buildCandidateWhere, ownedAccountsInclude } from './categorization-candidates';
import { type CategorizationScope } from './categorization-scope';
import { buildSystemPrompt, buildUserMessage } from './prompt-builder';
import {
  CategorizationBatchResult,
  CategorizationProgress,
  CategorizationResult,
  CategorizationSkip,
  TransactionForCategorization,
} from './types';
import { assignShortIds } from './utils/assign-short-ids';
import { buildCategoryList } from './utils/build-category-list';
import { parseCategorizationResponse } from './utils/parse-response';

const CUSTOM_ENDPOINT_ADDRESS_BLOCKED_ERROR_MESSAGE =
  'Your custom AI endpoint address was rejected. Please point it at a publicly reachable address in AI settings.';

const RATE_LIMITED_ERROR_MESSAGE = 'AI provider rate limit reached. Please try again in a few minutes.';

const TEMPORARY_ERROR_MESSAGE = 'AI provider temporarily unavailable. Please try again later.';

// Batch size of 500 provides ~9k tokens per batch (average case, with short
// alias ids). Well within safe limits for AI models while providing good
// progress feedback
const BATCH_SIZE = 500;

interface CategorizeBatchResult extends CategorizationBatchResult {
  /** How the AI call failed, when it did. Anything but `unknown` repeats on the next batch. */
  failureKind?: AiCallFailureKind;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

async function resolveStopReason({
  failureKind,
  reason,
  userId,
  aiClient,
}: {
  failureKind: Exclude<AiCallFailureKind, 'unknown'>;
  /** The provider's own error message */
  reason: string;
  userId: number;
  aiClient: AIClientResult;
}): Promise<string> {
  switch (failureKind) {
    case 'unsupported-request':
      return buildUnsupportedRequestMessage({ modelId: aiClient.modelId, reason });
    case 'auth':
      return markConnectionRejected({ userId, aiClient });
    case 'model-not-found':
      return markModelNotServed({ userId, aiClient });
    case 'endpoint-down':
      return markCustomEndpointUnreachable({ userId, aiClient });
    case 'blocked-address':
      return CUSTOM_ENDPOINT_ADDRESS_BLOCKED_ERROR_MESSAGE;
    case 'rate-limited':
      return RATE_LIMITED_ERROR_MESSAGE;
    case 'temporary':
      return TEMPORARY_ERROR_MESSAGE;
  }
}

/**
 * Categorize a batch of transactions using AI
 */
async function categorizeBatch({
  userId,
  aiClient,
  transactions,
  categories,
  customInstructions,
}: {
  userId: number;
  aiClient: AIClientResult;
  transactions: TransactionForCategorization[];
  categories: Awaited<ReturnType<typeof getCategories>>;
  customInstructions?: string;
}): Promise<CategorizeBatchResult> {
  const categoryList = buildCategoryList(categories);
  const shortIds = assignShortIds({ transactions, categories: categoryList });

  const systemPrompt = buildSystemPrompt({ customInstructions });
  const userMessage = buildUserMessage({
    transactions: shortIds.aliasedTransactions,
    categories: shortIds.aliasedCategories,
  });

  try {
    // A hung or trickling endpoint must abort instead of pinning a worker slot forever.
    const { abortSignal, maxRetries } = aiCallGuards({ provider: aiClient.provider });

    // A batch is up to BATCH_SIZE transactions and the model answers one line per
    // transaction, which can outgrow a provider's default output cap. Anything the
    // reply omits is already reported as `failed` below and retried, so a cut-off
    // response costs a retry rather than miscategorising -- but the cap still has to
    // be raised, or a large batch can never complete.
    const { text, usage, finishReason } = await generateText({
      model: aiClient.model,
      system: systemPrompt,
      prompt: userMessage,
      abortSignal,
      maxRetries,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    trackAiUsage({ userId, feature: AI_FEATURE.categorization, aiClient, usage });

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const tokensPerTransaction = transactions.length > 0 ? Math.round(totalTokens / transactions.length) : 0;

    logger.info('[AI Categorization] Batch completed', {
      modelId: aiClient.modelId,
      transactionCount: transactions.length,
      inputTokens,
      outputTokens,
      totalTokens,
      tokensPerTransaction,
    });

    const parsed = parseCategorizationResponse({
      response: text,
      validCategoryIds: new Set(shortIds.categoryIdByAlias.keys()),
      validTransactionIds: new Set(shortIds.transactionIdByAlias.keys()),
    });

    const results = parsed.categorized.map((result) => ({
      transactionId: shortIds.transactionIdByAlias.get(result.transactionId)!,
      categoryId: shortIds.categoryIdByAlias.get(result.categoryId)!,
    }));

    const successfulIds = new Set(results.map((r) => r.transactionId));

    // A category line and a skip line for the same row: the category wins.
    const skipReasonById = new Map<string, CATEGORIZATION_SKIP_REASON>();
    for (const skip of parsed.skipped) {
      const transactionId = shortIds.transactionIdByAlias.get(skip.transactionId)!;
      if (!successfulIds.has(transactionId)) skipReasonById.set(transactionId, skip.reason);
    }

    // Rows with no verdict at all: on a cleanly finished answer the model implicitly
    // declined them (prose refusals land here wholesale). Any other finish — truncation,
    // content filter, provider error, empty text — proves nothing about those rows, and
    // the skip stamp is permanent, so they stay candidates for the next run instead.
    //
    // `finishReason` alone would miss the truncation case: a gateway that cuts a reply
    // off at the output ceiling can still report `stop`, and that answer would then
    // stamp every unanswered row as a permanent skip. `hitOutputCeiling` also treats
    // spending the whole allowance as being cut off at it.
    const completedNormally =
      finishReason === 'stop' && text.trim().length > 0 && !hitOutputCeiling({ finishReason, usage });
    const failed: string[] = [];
    for (const transaction of transactions) {
      if (successfulIds.has(transaction.id) || skipReasonById.has(transaction.id)) continue;
      if (completedNormally) {
        skipReasonById.set(transaction.id, CATEGORIZATION_SKIP_REASON.unspecified);
      } else {
        failed.push(transaction.id);
      }
    }

    if (completedNormally && results.length === 0 && parsed.skipped.length === 0) {
      // Either a wholesale prose refusal or a model that ignores the answer format;
      // the preview is the only way to tell which from logs.
      logger.info('[AI Categorization] Batch finished with zero parseable verdicts', {
        modelId: aiClient.modelId,
        transactionCount: transactions.length,
        responsePreview: text.slice(0, 300),
      });
    }

    return {
      successful: results,
      skipped: Array.from(skipReasonById, ([transactionId, reason]) => ({ transactionId, reason })),
      failed,
      tokenUsage: {
        inputTokens,
        outputTokens,
      },
    };
  } catch (error) {
    const { kind, cause } = classifyAiCallFailure({ error });

    // Only a custom endpoint can be down in a way the user can fix, so a native
    // provider that answers with nothing is downgraded to a temporary failure.
    const failureKind =
      kind === 'endpoint-down' && aiClient.provider !== AI_PROVIDER.custom ? ('temporary' as const) : kind;

    if (failureKind === 'unknown') {
      logger.error({ message: 'AI categorization batch failed', error: cause });
    } else {
      // Expected user config or provider state, handled by the caller, so info keeps it out of Sentry.
      logger.info(`AI categorization batch failed (${failureKind}): ${cause.message}`);
    }

    return {
      successful: [],
      skipped: [],
      failed: transactions.map((t) => t.id),
      errors: [failureKind === 'blocked-address' ? CUSTOM_ENDPOINT_ADDRESS_BLOCKED_ERROR_MESSAGE : cause.message],
      failureKind,
    };
  }
}

/** One transaction, so a failed tag write rolls the categories back and the retry sees the rows again. */
const applyCategorizationResults = withTransaction(async function ({
  userId,
  results,
  candidateWhere,
  categorizedAt,
  trigger,
}: {
  userId: number;
  results: CategorizationResult[];
  candidateWhere: CandidateWhere;
  /** Shared by every batch of the run, so the stamp identifies the run in the history list. */
  categorizedAt: string;
  trigger?: CATEGORIZATION_TRIGGER;
}): Promise<void> {
  if (results.length === 0) return;

  const groupedByCategory = new Map<string, string[]>();
  for (const result of results) {
    if (!groupedByCategory.has(result.categoryId)) {
      groupedByCategory.set(result.categoryId, []);
    }
    groupedByCategory.get(result.categoryId)!.push(result.transactionId);
  }

  // Re-checks the predicate that selected these rows, which on `defaultCategoryOnly` leaves
  // a row the user categorized by hand mid-run alone.
  // `unscoped-internal` rather than a creator scope: the `Accounts` JOIN that produced these
  // ids already gated ownership, and a `userId` filter would drop shared-account rows a
  // recipient authored.
  const assignments = await Promise.all(
    Array.from(groupedByCategory.entries()).map(async ([categoryId, transactionIds]) => {
      const [, updatedRows = []] = await updateTransactions({
        values: {
          categoryId,
          categorizationMeta: {
            source: CATEGORIZATION_SOURCE.ai,
            categorizedAt,
            ...(trigger && { trigger }),
          },
        },
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { ...candidateWhere, id: transactionIds },
        returning: ['id'],
      });
      return { categoryId, transactionIds: updatedRows.map((row) => row.id) };
    }),
  );

  await applyCategoryDefaultTagsOnAiCategorization({ userId, assignments });
});

/**
 * Rows the AI declined get the run's stamp too — with `skipReason` and the category
 * untouched — so later runs stop paying tokens for rows the model already refused to
 * decide. Re-checks `candidateWhere` for the same mid-run-edit reason as above.
 */
async function applySkipStamps({
  skips,
  candidateWhere,
  categorizedAt,
  trigger,
}: {
  skips: CategorizationSkip[];
  candidateWhere: CandidateWhere;
  categorizedAt: string;
  trigger?: CATEGORIZATION_TRIGGER;
}): Promise<void> {
  if (skips.length === 0) return;

  const groupedByReason = new Map<CATEGORIZATION_SKIP_REASON, string[]>();
  for (const skip of skips) {
    if (!groupedByReason.has(skip.reason)) {
      groupedByReason.set(skip.reason, []);
    }
    groupedByReason.get(skip.reason)!.push(skip.transactionId);
  }

  await Promise.all(
    Array.from(groupedByReason.entries()).map(([skipReason, transactionIds]) =>
      updateTransactions({
        values: {
          categorizationMeta: {
            source: CATEGORIZATION_SOURCE.ai,
            categorizedAt,
            skipReason,
            ...(trigger && { trigger }),
          },
        },
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { ...candidateWhere, id: transactionIds },
      }),
    ),
  );
}

/**
 * The rows this run is allowed to decide, per its `candidateWhere`. Not necessarily
 * uncategorized: on the auto-path a `hint`-mode Payee rule leaves a real category behind
 * for the AI to reconsider.
 */
async function selectCandidateTransactions({
  userId,
  transactionIds,
  candidateWhere,
}: {
  userId: number;
  transactionIds: string[];
  candidateWhere: CandidateWhere;
}): Promise<TransactionForCategorization[]> {
  const transactions = await findTransactions({
    planned: 'exclude',
    access: { accountOwner: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { ...candidateWhere, id: transactionIds },
    include: [
      ownedAccountsInclude({ userId, attributes: ['name'] }),
      {
        model: Payees,
        attributes: ['name'],
        required: false,
      },
    ],
    attributes: ['id', 'amount', 'currencyCode', 'time', 'note', 'accountId', 'payeeId'],
  });

  return transactions.map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    currencyCode: tx.currencyCode,
    accountName: (tx as unknown as { account?: { name: string } }).account?.name || 'Unknown',
    datetime: tx.time.toISOString(),
    note: tx.note,
    payeeName: (tx as unknown as { payee?: { name: string } }).payee?.name ?? null,
  }));
}

/**
 * Categorize transactions using AI, in batches of BATCH_SIZE. The first classified
 * failure stops the run and returns partial results with `stopReason` set.
 */
export async function categorizeTransactions({
  userId,
  transactionIds,
  scope,
  trigger,
  totalTransactionCount,
  onProgress,
}: {
  userId: number;
  transactionIds: string[];
  /** Which rows this run may touch. Selection and write-back both use it. */
  scope: CategorizationScope;
  /** Recorded on every stamp so the history list can label what started the run. */
  trigger?: CATEGORIZATION_TRIGGER;
  /** For progress tracking. Defaults to transactionIds.length */
  totalTransactionCount?: number;
  onProgress?: (progress: CategorizationProgress) => void | Promise<void>;
}): Promise<CategorizationBatchResult> {
  const totalCount = totalTransactionCount ?? transactionIds.length;
  const aiClient = await createAIClient({
    userId,
    feature: AI_FEATURE.categorization,
  });

  if (!aiClient) {
    // Routinely the user's own state (no key configured, endpoints flagged down), and
    // warn would report every such run to Sentry.
    logger.info('No AI provider available for categorization', { userId });
    const missingConfigurationMessage = await describeMissingAiConfiguration({ userId });
    return {
      successful: [],
      skipped: [],
      failed: transactionIds,
      errors: [missingConfigurationMessage],
      stopReason: missingConfigurationMessage,
    };
  }

  logger.info('Using AI provider for categorization', {
    userId,
    provider: aiClient.provider,
    modelId: aiClient.modelId,
    usingUserKey: aiClient.usingUserKey,
  });

  const categories = await getCategories({ userId });
  if (categories.length === 0) {
    logger.info(`User ${userId} has no categories, skipping categorization`);
    return {
      successful: [],
      skipped: [],
      failed: transactionIds,
      errors: ['No categories configured'],
      stopReason: 'No categories configured',
    };
  }

  const candidateWhere = await buildCandidateWhere({ userId, scope });
  if (!candidateWhere) {
    logger.info(`User ${userId} has no default category, skipping categorization`);
    return {
      successful: [],
      skipped: [],
      failed: [],
    };
  }

  const transactions = await selectCandidateTransactions({ userId, transactionIds, candidateWhere });
  if (transactions.length === 0) {
    logger.info(`No uncategorized transactions to process for user ${userId}`);
    return {
      successful: [],
      skipped: [],
      failed: [],
    };
  }

  let customInstructions: string | undefined;
  if (aiClient.usingUserKey) {
    try {
      customInstructions = await getCustomInstructions({ userId });
    } catch (error) {
      logger.error({ message: 'Failed to fetch custom instructions, proceeding without them', error: error as Error });
    }
  }

  logger.info(`Starting AI categorization for ${transactions.length} transactions for user ${userId}`);

  const allResults: CategorizationBatchResult = {
    successful: [],
    skipped: [],
    failed: [],
    errors: [],
  };

  const totalTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    batchCount: 0,
  };

  const reportProcessing = async () => {
    const progress: CategorizationProgress = {
      processedCount: allResults.successful.length + allResults.skipped.length + allResults.failed.length,
      totalCount,
      failedCount: allResults.failed.length,
      skippedCount: allResults.skipped.length,
    };
    sseManager.sendToUser({
      userId,
      event: SSE_EVENT_TYPES.AI_CATEGORIZATION_PROGRESS,
      data: { status: 'processing' as const, ...progress },
    });
    // Progress is cosmetic, so a failing sink must not abort the run and discard finished batches.
    try {
      await onProgress?.(progress);
    } catch (error) {
      logger.error({
        message: `[AI Categorization] Failed to report progress for user ${userId}`,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  };

  // One stamp for the whole run: the history list groups transactions by it, so a
  // per-batch stamp would split a single run into several entries.
  const categorizedAt = new Date().toISOString();

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    logger.info(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(transactions.length / BATCH_SIZE)}`);

    // Reported before the LLM call: a single batch can run for minutes on a slow
    // model, and the UI would otherwise sit on "queued" that whole time.
    await reportProcessing();

    const batchResult = await categorizeBatch({
      userId,
      aiClient,
      transactions: batch,
      categories,
      customInstructions,
    });

    // A classified failure holds for the whole run (the endpoint stays down, the model
    // stays missing), so the first one stops it. Unclassified ones may be batch-specific.
    if (batchResult.failureKind && batchResult.failureKind !== 'unknown') {
      const stopReason = await resolveStopReason({
        failureKind: batchResult.failureKind,
        reason: batchResult.errors?.[0] ?? '',
        userId,
        aiClient,
      });

      logger.info(`Stopping AI categorization (${batchResult.failureKind}): ${stopReason}`, {
        userId,
        provider: aiClient.provider,
        modelId: aiClient.modelId,
        usingUserKey: aiClient.usingUserKey,
      });

      allResults.failed.push(...transactions.slice(i).map((t) => t.id));
      allResults.errors!.push(stopReason);
      allResults.stopReason = stopReason;
      break;
    }

    if (batchResult.successful.length > 0) {
      await applyCategorizationResults({
        userId,
        results: batchResult.successful,
        candidateWhere,
        categorizedAt,
        trigger,
      });
    }
    if (batchResult.skipped.length > 0) {
      await applySkipStamps({ skips: batchResult.skipped, candidateWhere, categorizedAt, trigger });
    }

    // Skips prove the credentials work just as well as categorizations do.
    if ((batchResult.successful.length > 0 || batchResult.skipped.length > 0) && aiClient.connectionId) {
      await markConnectionValid({ userId, connectionId: aiClient.connectionId });
    }

    allResults.successful.push(...batchResult.successful);
    allResults.skipped.push(...batchResult.skipped);
    allResults.failed.push(...batchResult.failed);
    if (batchResult.errors) {
      allResults.errors!.push(...batchResult.errors);
    }

    if (batchResult.tokenUsage) {
      totalTokenUsage.inputTokens += batchResult.tokenUsage.inputTokens;
      totalTokenUsage.outputTokens += batchResult.tokenUsage.outputTokens;
      totalTokenUsage.batchCount += 1;
    }
  }

  const totalTransactionsProcessed =
    allResults.successful.length + allResults.skipped.length + allResults.failed.length;
  const totalTokens = totalTokenUsage.inputTokens + totalTokenUsage.outputTokens;
  const avgTokensPerTransaction =
    totalTransactionsProcessed > 0 ? Math.round(totalTokens / totalTransactionsProcessed) : 0;

  logger.info('[AI Categorization] Job completed', {
    userId,
    modelId: aiClient.modelId,
    provider: aiClient.provider,
    usingUserKey: aiClient.usingUserKey,
    transactionsProcessed: totalTransactionsProcessed,
    successfulCount: allResults.successful.length,
    skippedCount: allResults.skipped.length,
    failedCount: allResults.failed.length,
    batchCount: totalTokenUsage.batchCount,
    batchSize: BATCH_SIZE,
    totalInputTokens: totalTokenUsage.inputTokens,
    totalOutputTokens: totalTokenUsage.outputTokens,
    totalTokens,
    avgTokensPerTransaction,
  });

  if (allResults.successful.length > 0) {
    trackAiCategorization({
      userId,
      categorizedCount: allResults.successful.length,
      failedCount: allResults.failed.length,
      provider: aiClient.provider,
      modelId: aiClient.modelId,
      usingUserKey: aiClient.usingUserKey,
    });
  }

  return allResults;
}
