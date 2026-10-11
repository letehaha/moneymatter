import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { AI_PROVIDER, RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { createProviderModel } from '@services/ai/ai-client-factory';
import { classifyAiCallFailure, isAbortError } from '@services/ai/ai-error-classifiers';
import { AI_MAX_OUTPUT_TOKENS } from '@services/ai/ai-output-limit';
import { getServerApiKey, suspendAnthropicServerKey } from '@services/ai/resolution-ladder';
import { createShortIds } from '@services/ai/short-ids';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { createCategoryClaims } from '@services/categories/category-hierarchy';
import { RateLimitService } from '@services/common/rate-limit.service';
import { Output, generateText } from 'ai';
import { z } from 'zod';

const CALLS_PER_USER_PER_DAY = 30;
const PAID_MODEL_CALLS_PER_USER_PER_DAY = 5;
const PAID_MODEL_CALLS_PER_DAY = 300;
const DAY_SECONDS = 24 * 60 * 60;
const CALL_TIMEOUT_MS = 30_000;
export const MAX_AI_LINES = 15;
export const MAX_AI_GROUPS = 5;

/** Billed per call, so capped; the free-tier model takes the rest. */
const PAID_MODEL = { provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' } as const;
const FREE_MODEL = { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' } as const;

export interface LineCandidate {
  id: string;
  /** `Parent › Child`, so the model sees the hierarchy without ids. */
  path: string;
  /** Spend over the history window on the category and its descendants, as a line on it would cover. */
  totalCents: number;
}

interface SuggestedLayout {
  groups: { name: string; lines: { name: string; categoryIds: RecordId[] }[] }[];
}

const layoutSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      lines: z.array(z.object({ name: z.string(), categoryIds: z.array(z.string()) })),
    }),
  ),
});

const systemPrompt = ({ locale, currencyCode }: { locale: string; currencyCode: string }) =>
  `You organise a personal budget into lines and groups.
Input: one expense category per row as "id | path | spent", where spent is the total of the last 3 months in ${currencyCode}. A parent's spent includes its children's; spent 0 means no recent history. Categories may be named in any language and nested in any way, or not at all; judge them by what they mean. Examples in the rules are illustrations, not names to look for.
Return groups, each with a name and lines; a line has a name and the category ids it covers.

Rules:
- Names in the language of locale "${locale}": short, plain words, no emoji.
- 2 to ${MAX_AI_GROUPS} groups, ordered from fixed commitments through everyday spending to lifestyle. Fixed commitments recur at the same size (for example rent, utilities, insurance, taxes, loan payments); variable costs such as fuel, car upkeep, transport and groceries are everyday spending.
- At most ${MAX_AI_LINES} lines in total; fewer, broader lines beat many narrow ones.
- Merge categories that mean the same thing (Groceries and Supermarket, Fuel and Petrol) into one line. Keep clearly different kinds of spending apart.
- A category with spent 0 may only join a line that already has spending. Never build a line from zero-spend categories alone; leave out the ones that fit nowhere.
- Use only ids from the input, each at most once. A parent id already covers every category under it: list the parent alone when all its children belong in the line, otherwise list only the children. Never put a parent in one line and its child in another.
- Lines are for spending worth planning: a category under 2% of the total spent goes into a related line or is left out.`;

/**
 * Drops what the model got wrong so the lines can be created as returned: unknown or
 * repeated ids, a category whose ancestor or descendant another line already holds, lines
 * left with no spending, blank names, empty groups, and anything past the caps.
 */
export const sanitizeLayout = ({
  layout,
  candidates,
  byId,
}: {
  layout: z.infer<typeof layoutSchema>;
  candidates: LineCandidate[];
  byId: Map<string, { id: string; parentId: string | null }>;
}): SuggestedLayout => {
  const spendById = new Map(candidates.map((candidate) => [candidate.id, candidate.totalCents]));
  const { take, overlaps } = createCategoryClaims({ byId });

  let lineBudget = MAX_AI_LINES;
  const groups: SuggestedLayout['groups'] = [];

  for (const group of layout.groups) {
    if (groups.length === MAX_AI_GROUPS) break;
    const groupName = group.name.trim();
    if (!groupName) continue;
    const lines: SuggestedLayout['groups'][number]['lines'] = [];

    for (const line of group.lines) {
      if (lineBudget === 0) break;
      const name = line.name.trim();
      if (!name) continue;
      const categoryIds = [...new Set(line.categoryIds)].filter(
        (categoryId) => spendById.has(categoryId) && !overlaps({ categoryId }),
      ) as RecordId[];
      if (!categoryIds.some((categoryId) => spendById.get(categoryId)! > 0)) continue;

      for (const categoryId of categoryIds) take({ categoryId });
      lines.push({ name, categoryIds });
      lineBudget -= 1;
    }

    if (lines.length) groups.push({ name: groupName, lines });
  }

  return { groups };
};

/** The paid model answers the first few runs a day per user and per deployment. */
const underPaidModelCap = async ({ userId }: { userId: number }): Promise<boolean> => {
  const user = await RateLimitService.checkRateLimit(
    `budget-ai-paid:user:${userId}`,
    DAY_SECONDS,
    PAID_MODEL_CALLS_PER_USER_PER_DAY,
  );
  if (!user.allowed || user.serviceUnavailable) return false;

  const global = await RateLimitService.checkRateLimit('budget-ai-paid:global', DAY_SECONDS, PAID_MODEL_CALLS_PER_DAY);
  return global.allowed && !global.serviceUnavailable;
};

const pickModels = async ({ userId }: { userId: number }) => {
  const specs: { provider: AI_PROVIDER.anthropic | AI_PROVIDER.google; model: string; apiKey: string }[] = [];

  // The Plus key serves this feature for every budgeting user; the daily cap is what keeps that affordable.
  const anthropicKey = getServerApiKey({ provider: AI_PROVIDER.anthropic, paidPlus: true });
  if (anthropicKey && (await underPaidModelCap({ userId }))) specs.push({ ...PAID_MODEL, apiKey: anthropicKey });

  const geminiKey = getServerApiKey();
  if (geminiKey) specs.push({ ...FREE_MODEL, apiKey: geminiKey });

  return specs;
};

/**
 * Asks a model to arrange the candidate categories into named groups and lines. Amounts
 * never come from the model. Returns null when no server key is set, the user is over the
 * daily cap, or every model fails, so the caller can fall back to the rule-based suggestions.
 */
export const organizeLinesWithAi = async ({
  userId,
  candidates,
  byId,
  locale,
  currencyCode,
}: {
  userId: number;
  candidates: LineCandidate[];
  byId: Map<string, { id: string; parentId: string | null }>;
  locale: string;
  currencyCode: string;
}): Promise<{ layout: SuggestedLayout; modelId: string } | null> => {
  const userCap = await RateLimitService.checkRateLimit(
    `budget-ai:user:${userId}`,
    DAY_SECONDS,
    CALLS_PER_USER_PER_DAY,
  );
  if (!userCap.allowed || userCap.serviceUnavailable) return null;

  const shortIds = createShortIds({ ids: candidates.map((candidate) => candidate.id), prefix: 'c' });
  const prompt = candidates
    .map(
      (candidate) =>
        `${shortIds.aliasOf({ id: candidate.id })} | ${candidate.path} | ${Money.fromCents(candidate.totalCents).toDecimalString(2)}`,
    )
    .join('\n');
  for (const spec of await pickModels({ userId })) {
    const modelId = `${spec.provider}/${spec.model}`;

    // Destructuring inside `then` keeps a structured-output parse failure in the catch.
    const answer = await generateText({
      model: createProviderModel(spec),
      output: Output.object({ schema: layoutSchema, name: 'budget_layout' }),
      system: systemPrompt({ locale, currencyCode }),
      prompt,
      providerOptions: {
        anthropic: { thinking: { type: 'disabled' } } satisfies AnthropicProviderOptions,
        google: { thinkingConfig: { thinkingLevel: 'minimal' } } satisfies GoogleGenerativeAIProviderOptions,
      },
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: 1,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    })
      .then(({ output, usage }) => ({ output, usage }))
      .catch((error: unknown) => {
        const meta = { userId, modelId, error: error as Error };
        if (isAbortError({ error })) {
          logger.warn('[Budget suggestions] AI call timed out, trying the next model', meta);
          return null;
        }
        logger.error('[Budget suggestions] AI call failed, trying the next model', meta);

        const { kind } = classifyAiCallFailure({ error });
        if (spec.provider === AI_PROVIDER.anthropic && (kind === 'auth' || kind === 'model-not-found')) {
          suspendAnthropicServerKey({ reason: `budget suggestions: ${kind}` });
        }
        return null;
      });
    if (!answer) continue;

    trackAiUsage({
      userId,
      feature: 'budget_suggestions',
      aiClient: { provider: spec.provider, modelId, usingUserKey: false },
      usage: answer.usage,
    });

    const layout = sanitizeLayout({
      candidates,
      byId,
      layout: {
        groups: answer.output.groups.map((group) => ({
          ...group,
          lines: group.lines.map((line) => ({
            ...line,
            categoryIds: shortIds.resolve({ aliases: line.categoryIds }),
          })),
        })),
      },
    });
    if (layout.groups.length) return { layout, modelId };
    logger.warn('[Budget suggestions] AI layout had no usable line', { userId, modelId });
  }

  return null;
};
