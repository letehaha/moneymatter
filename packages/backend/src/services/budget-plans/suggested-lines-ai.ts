import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { AI_PROVIDER, RecordId } from '@bt/shared/types';
import type { BudgetSuggestionAnswers } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { isWithinAiAllowance } from '@services/ai/ai-allowance';
import { createProviderModel } from '@services/ai/ai-client-factory';
import { classifyAiCallFailure, isAbortError } from '@services/ai/ai-error-classifiers';
import { AI_MAX_OUTPUT_TOKENS } from '@services/ai/ai-output-limit';
import {
  PRIMARY_SERVER_MODEL,
  type ServerModel,
  getServerApiKey,
  suspendPrimaryServerKey,
} from '@services/ai/resolution-ladder';
import { createShortIds } from '@services/ai/short-ids';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { createCategoryClaims } from '@services/categories/category-hierarchy';
import { RateLimitService } from '@services/common/rate-limit.service';
import { Output, generateText } from 'ai';
import { z } from 'zod';

const CALLS_PER_USER_PER_DAY = 30;
const PRIMARY_MODEL_CALLS_PER_USER_PER_DAY = 5;
const PRIMARY_MODEL_CALLS_PER_DAY = 300;
const DAY_SECONDS = 24 * 60 * 60;
const CALL_TIMEOUT_MS = 30_000;
export const MAX_AI_LINES = 15;
export const MAX_AI_GROUPS = 5;

type Detail = NonNullable<BudgetSuggestionAnswers['detail']>;
const DETAIL_MAX_LINES: Record<Detail, number> = { compact: 8, balanced: 12, detailed: 20 };
export const maxLinesFor = ({ detail, fallback }: { detail?: Detail; fallback: number }) =>
  detail ? DETAIL_MAX_LINES[detail] : fallback;
const DETAIL_RULE: Record<Detail, string> = {
  compact: 'Aim for 6 to 8 lines: broad lines that merge related spending.',
  balanced: 'Aim for 10 to 12 lines.',
  detailed: 'Aim for 15 to 20 lines: give each distinct kind of spending its own line.',
};

const ANSWER_FACTS = {
  housing: {
    mortgage: 'Pays a mortgage.',
    rent: 'Rents their home.',
    family: 'Lives with family; no rent or mortgage of their own.',
    owned: 'Owns their home outright; no rent or mortgage.',
  },
  transport: {
    car: 'Owns a car.',
    transit: 'Gets around by public transport; no car.',
    bikeWalk: 'Gets around by bike or on foot; no car.',
    multiple: 'Uses a car and public transport.',
  },
  pets: { none: 'Has no pets.', dog: 'Has a dog.', cat: 'Has a cat.', other: 'Has pets.' },
  eatsOut: {
    often: 'Eats out or orders food often.',
    sometimes: 'Eats out or orders food sometimes.',
    rarely: 'Rarely eats out or orders food.',
  },
  subscriptions: {
    many: 'Pays for many subscriptions.',
    few: 'Pays for a few subscriptions.',
    none: 'Has no paid subscriptions.',
  },
} as const;

const userFacts = ({ answers }: { answers: BudgetSuggestionAnswers }): string[] =>
  [
    answers.housing && ANSWER_FACTS.housing[answers.housing],
    answers.transport && ANSWER_FACTS.transport[answers.transport],
    answers.pets && ANSWER_FACTS.pets[answers.pets],
    answers.eatsOut && ANSWER_FACTS.eatsOut[answers.eatsOut],
    answers.subscriptions && ANSWER_FACTS.subscriptions[answers.subscriptions],
  ].flatMap((fact) => (fact ? [fact] : []));

/** Whether the answers say anything a layout can be built from; the detail level alone does not. */
export const hasGuidance = ({ answers }: { answers: BudgetSuggestionAnswers }) =>
  userFacts({ answers }).length > 0 || !!answers.focusCategoryIds?.length;

/** Backs up the primary server model, which is billed per call and so capped daily. */
const FALLBACK_MODEL = { provider: AI_PROVIDER.google, model: 'gemini-3.8-flash' } as const;

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

const systemPrompt = ({
  locale,
  currencyCode,
  detail,
  hasHistory,
  facts,
  focusPaths,
}: {
  locale: string;
  currencyCode: string;
  detail?: Detail;
  hasHistory: boolean;
  facts: string[];
  focusPaths: string[];
}) => {
  const rules = [
    `Names in the language of locale "${locale}": short, plain words, no emoji.`,
    `2 to ${MAX_AI_GROUPS} groups, ordered from fixed commitments through everyday spending to lifestyle. Fixed commitments recur at the same size (for example rent, utilities, insurance, taxes, loan payments); variable costs such as fuel, car upkeep, transport and groceries are everyday spending.`,
    detail
      ? `${DETAIL_RULE[detail]} Never more than ${maxLinesFor({ detail, fallback: MAX_AI_LINES })}.`
      : `At most ${MAX_AI_LINES} lines in total; fewer, broader lines beat many narrow ones.`,
    'Merge categories that mean the same thing (Groceries and Supermarket, Fuel and Petrol) into one line. Keep clearly different kinds of spending apart.',
    hasHistory
      ? 'A category with spent 0 may only join a line that already has spending. Never build a line from zero-spend categories alone; leave out the ones that fit nowhere.'
      : "There is no spending history, so every spent is 0. Build a starter budget from the user's answers and the essentials most households pay for (housing, utilities, groceries, transport, phone and internet, health). Leave out categories nothing points to.",
    'Use only ids from the input, each at most once. A parent id already covers every category under it: list the parent alone when all its children belong in the line, otherwise list only the children. Never put a parent in one line and its child in another.',
    ...(hasHistory
      ? [
          'Lines are for spending worth planning: a category under 2% of the total spent goes into a related line or is left out.',
        ]
      : []),
    ...(focusPaths.length
      ? [
          `${hasHistory ? 'The user wants to watch these closely; give each of their sub-categories with spending its own line' : 'The user also spends on these; give each its own line'}: ${focusPaths.join('; ')}.`,
        ]
      : []),
  ];
  const about = facts.length
    ? `\n\nAbout the user, from their own answers:\n${facts.map((fact) => `- ${fact}`).join('\n')}\nDon't create a line for a kind of spending the answers rule out unless it has spending.`
    : '';

  return `You organise a personal budget into lines and groups.
Input: one expense category per row as "id | path | spent", where spent is the total of the last 3 months in ${currencyCode}. A parent's spent includes its children's; spent 0 means no recent history. Categories may be named in any language and nested in any way, or not at all; judge them by what they mean. Examples in the rules are illustrations, not names to look for.
Return groups, each with a name and lines; a line has a name and the category ids it covers.

Rules:
${rules.map((rule) => `- ${rule}`).join('\n')}${about}`;
};

/**
 * Drops what the model got wrong so the lines can be created as returned: unknown or
 * repeated ids, a category whose ancestor or descendant another line already holds, lines
 * left with no spending when `requireSpend`, blank names, empty groups, and anything past the caps.
 */
export const sanitizeLayout = ({
  layout,
  candidates,
  byId,
  maxLines = MAX_AI_LINES,
  requireSpend = true,
}: {
  layout: z.infer<typeof layoutSchema>;
  candidates: LineCandidate[];
  byId: Map<string, { id: string; parentId: string | null }>;
  maxLines?: number;
  requireSpend?: boolean;
}): SuggestedLayout => {
  const spendById = new Map(candidates.map((candidate) => [candidate.id, candidate.totalCents]));
  const { take, overlaps } = createCategoryClaims({ byId });

  let lineBudget = maxLines;
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
      if (!categoryIds.length) continue;
      if (requireSpend && !categoryIds.some((categoryId) => spendById.get(categoryId)! > 0)) continue;

      for (const categoryId of categoryIds) take({ categoryId });
      lines.push({ name, categoryIds });
      lineBudget -= 1;
    }

    if (lines.length) groups.push({ name: groupName, lines });
  }

  return { groups };
};

/** The primary server model answers the first few runs a day per user and per deployment. */
const underPrimaryModelCap = async ({ userId }: { userId: number }): Promise<boolean> => {
  const user = await RateLimitService.checkRateLimit(
    `budget-ai-paid:user:${userId}`,
    DAY_SECONDS,
    PRIMARY_MODEL_CALLS_PER_USER_PER_DAY,
  );
  if (!user.allowed || user.serviceUnavailable) return false;

  const global = await RateLimitService.checkRateLimit(
    'budget-ai-paid:global',
    DAY_SECONDS,
    PRIMARY_MODEL_CALLS_PER_DAY,
  );
  return global.allowed && !global.serviceUnavailable;
};

const pickModels = async ({ userId }: { userId: number }) => {
  const specs: (ServerModel & { apiKey: string })[] = [];

  if (!(await isWithinAiAllowance({ userId }))) return specs;

  // The server key serves this feature for every budgeting user; the daily cap is what keeps that affordable.
  const primaryKey = getServerApiKey({ provider: PRIMARY_SERVER_MODEL.provider });
  if (primaryKey && (await underPrimaryModelCap({ userId }))) {
    specs.push({ ...PRIMARY_SERVER_MODEL, apiKey: primaryKey });
  }

  const fallbackKey = getServerApiKey();
  if (fallbackKey) specs.push({ ...FALLBACK_MODEL, apiKey: fallbackKey });

  return specs;
};

/**
 * Asks a model to arrange the candidate categories into named groups and lines. Amounts
 * never come from the model. Returns null when there is neither spending nor an answer to
 * go on, no server key is set, the user is over the daily cap or the AI allowance, or every model fails, so the
 * caller can fall back to the rule-based suggestions.
 */
export const organizeLinesWithAi = async ({
  userId,
  candidates,
  byId,
  locale,
  currencyCode,
  answers,
}: {
  userId: number;
  candidates: LineCandidate[];
  byId: Map<string, { id: string; parentId: string | null }>;
  locale: string;
  currencyCode: string;
  answers: BudgetSuggestionAnswers;
}): Promise<{ layout: SuggestedLayout; modelId: string } | null> => {
  const hasHistory = candidates.some((candidate) => candidate.totalCents > 0);
  // Spending says how the user lives better than a self-report, so the facts only stand in for it.
  const facts = hasHistory ? [] : userFacts({ answers });
  const focusPaths = candidates
    .filter((candidate) => answers.focusCategoryIds?.includes(candidate.id))
    .map((candidate) => candidate.path);
  if (!candidates.length || (!hasHistory && !facts.length && !focusPaths.length)) return null;

  const userCap = await RateLimitService.checkRateLimit(
    `budget-ai:user:${userId}`,
    DAY_SECONDS,
    CALLS_PER_USER_PER_DAY,
  );
  if (userCap.serviceUnavailable) {
    logger.warn('[Budget suggestions] Rate limiter unavailable, skipping the AI layout', { userId });
    return null;
  }
  if (!userCap.allowed) {
    logger.warn('[Budget suggestions] Daily AI cap reached, skipping the AI layout', { userId });
    return null;
  }

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
      system: systemPrompt({ locale, currencyCode, detail: answers.detail, hasHistory, facts, focusPaths }),
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
        if (spec.provider === PRIMARY_SERVER_MODEL.provider && (kind === 'auth' || kind === 'model-not-found')) {
          suspendPrimaryServerKey({ reason: `budget suggestions: ${kind}` });
        }
        return null;
      });
    if (!answer) continue;

    await trackAiUsage({
      userId,
      feature: 'budget_suggestions',
      aiClient: { provider: spec.provider, modelId, usingUserKey: false },
      usage: answer.usage,
    });

    const layout = sanitizeLayout({
      candidates,
      byId,
      maxLines: maxLinesFor({ detail: answers.detail, fallback: MAX_AI_LINES }),
      requireSpend: hasHistory,
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
