import { AI_FEATURE, type AiMapImportCategoriesResponse } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import { CacheClient } from '@js/utils/cache';
import { getCategories } from '@models/categories.model';
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_OUTPUT_TRUNCATED_MESSAGE,
  aiCallGuards,
  createAIClient,
  describeMissingAiConfiguration,
  hitOutputCeiling,
} from '@services/ai';
import { assignShortIds } from '@services/ai-categorization/utils/assign-short-ids';
import { normalizeToken } from '@services/ai-categorization/utils/parse-response';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { resolveAiExtractionFailure } from '@services/import-export/core/ai-extraction-failure';
import { generateText } from 'ai';
import { createHash } from 'crypto';

const sanitize = (value: string) => value.replace(/\|/g, ',').replace(/\n/g, ' ').slice(0, 200);

/**
 * Identical sources, categories, and model give identical verdicts, so a page refresh
 * or wizard restart reuses them. The hash key self-invalidates on any input change.
 * The week TTL is the only way to re-roll verdicts for unchanged inputs; keep it short.
 */
const verdictCache = new CacheClient<Record<string, string | null>>({
  ttl: 7 * 24 * 60 * 60,
  logPrefix: '[AI Category Mapping]',
});

function buildCacheKey({
  userId,
  modelId,
  sources,
  categories,
}: {
  userId: number;
  modelId: string;
  sources: string[];
  categories: { id: string; parentId: string | null; name: string }[];
}): string {
  const fingerprint = JSON.stringify({
    modelId,
    sources: sources.toSorted(),
    categories: categories.map((category) => [category.id, category.parentId, category.name]).toSorted(),
  });
  return `ai-map-categories:${userId}:${createHash('sha256').update(fingerprint).digest('hex')}`;
}

const SYSTEM_PROMPT = `You are matching imported transaction category names against a user's existing categories.

RULES:
1. For each source name, pick the existing category that represents the same kind of spending or income. Names may be in different languages or spellings — match by meaning (e.g. "Продукти" matches "Groceries", "Bar, cafe" matches "Restaurants").
2. Only use category ids from the provided list.
3. Answer "none" when no existing category is a reasonable match. Do not force a match.
4. Every source MUST appear in your response exactly once.
5. Output ONLY the results in the exact format specified, nothing else.

OUTPUT FORMAT:
One line per source, in one of these two exact formats:
sourceId:categoryId
sourceId:none

Source ids look like "s1", "s2"; category ids look like "c1", "c2". Copy them exactly as given.

Example:
s1:c4
s2:none
s3:c12`;

/**
 * Ask the AI to link each imported source category name to one of the user's
 * existing categories. Uses the same model the user configured for AI
 * categorization. Sources the model cannot match come back as null.
 */
export async function aiMapImportCategories({
  userId,
  sourceCategories,
}: {
  userId: number;
  sourceCategories: string[];
}): Promise<AiMapImportCategoriesResponse> {
  const aiClient = await createAIClient({ userId, feature: AI_FEATURE.categorization });

  if (!aiClient) {
    throw new ValidationError({ message: await describeMissingAiConfiguration({ userId }) });
  }

  const categories = await getCategories({ userId });
  const sources = [...new Set(sourceCategories)];

  // Every source answers, defaulting to "no match".
  const mappings: Record<string, string | null> = Object.fromEntries(sources.map((name) => [name, null]));

  if (categories.length === 0) return { mappings };

  const cacheKey = buildCacheKey({ userId, modelId: aiClient.modelId, sources, categories });
  const cachedMappings = await verdictCache.read(cacheKey);
  if (cachedMappings) {
    logger.info('[AI Category Mapping] Serving cached verdicts', { userId, sourceCount: sources.length });
    // Sliding TTL: a hit means the import is still active, so re-arm the full week.
    await verdictCache.write({ key: cacheKey, value: cachedMappings });
    return { mappings: cachedMappings };
  }

  const { aliasedCategories, categoryIdByAlias } = assignShortIds({
    transactions: [],
    categories: categories.map((category) => ({ id: category.id, parentId: category.parentId, name: category.name })),
  });

  const sourceNameByAlias = new Map<string, string>();

  const categoryLines = aliasedCategories.map(
    (category) => `${category.id}|${category.parentId ?? ''}|${sanitize(category.name)}`,
  );

  const sourceLines = sources.map((name, index) => {
    const alias = `s${index + 1}`;
    sourceNameByAlias.set(alias, name);
    return `${alias}|${sanitize(name)}`;
  });

  const userMessage = `EXISTING CATEGORIES:
id|parentId|name
${categoryLines.join('\n')}

SOURCE CATEGORY NAMES:
id|name
${sourceLines.join('\n')}

Match each source name to the best existing category, or "none". Output one line per source: sourceId:categoryId or sourceId:none.`;

  logger.info('[AI Category Mapping] Starting', {
    userId,
    modelId: aiClient.modelId,
    provider: aiClient.provider,
    sourceCount: sources.length,
    categoryCount: categories.length,
  });

  try {
    const { abortSignal, maxRetries } = aiCallGuards({ provider: aiClient.provider });

    const { text, usage, finishReason } = await generateText({
      model: aiClient.model,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      abortSignal,
      maxRetries,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    trackAiUsage({ userId, feature: AI_FEATURE.categorization, aiClient, usage });

    // A truncated answer silently loses the sources after the cut, which would
    // read as "the AI found no match" instead of an error.
    if (hitOutputCeiling({ finishReason, usage })) {
      throw new ValidationError({ message: AI_OUTPUT_TRUNCATED_MESSAGE });
    }

    const answered = new Set<string>();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;
      const sourceName = sourceNameByAlias.get(normalizeToken({ raw: trimmed.slice(0, colonIndex), aliasPrefix: 's' }));
      if (sourceName === undefined) continue;
      const verdict = normalizeToken({ raw: trimmed.slice(colonIndex + 1), aliasPrefix: 'c' });
      answered.add(sourceName);
      mappings[sourceName] = verdict === 'none' ? null : (categoryIdByAlias.get(verdict) ?? null);
    }

    if (answered.size === 0) {
      logger.info('[AI Category Mapping] Unparseable AI response', { userId, excerpt: text.slice(0, 500) });
      throw new ValidationError({ message: 'Failed to parse AI response. The output was not in expected format.' });
    }
    if (answered.size < sources.length) {
      logger.warn('[AI Category Mapping] AI answered only some sources', {
        userId,
        answeredCount: answered.size,
        sourceCount: sources.length,
      });
    }

    const matchedCount = Object.values(mappings).filter(Boolean).length;

    logger.info('[AI Category Mapping] Completed', {
      userId,
      modelId: aiClient.modelId,
      sourceCount: sources.length,
      matchedCount,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    // Cache only complete, non-empty verdict sets: a partial answer would pin
    // never-judged sources as null for the whole TTL, and an all-null set is
    // more likely model drift than a real verdict.
    if (matchedCount > 0 && answered.size === sources.length) {
      await verdictCache.write({ key: cacheKey, value: mappings });
    }

    return { mappings };
  } catch (error) {
    if (error instanceof ValidationError) throw error;

    const { error: resolved } = await resolveAiExtractionFailure({
      userId,
      aiClient,
      error,
      logPrefix: '[AI Category Mapping]',
    });

    throw new ValidationError({ message: resolved.message });
  }
}
