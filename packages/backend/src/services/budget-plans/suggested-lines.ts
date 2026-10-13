import { RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import {
  AddSuggestedBudgetLinesResponse,
  BudgetPlanCadence,
  BudgetSuggestionAnswers,
  BudgetSuggestionContext,
} from '@bt/shared/types';
import { requestContext } from '@common/request-context';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { trackEvent } from '@js/utils/posthog';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import type { BudgetLineOrigin } from '@models/budget-lines.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import {
  createCategoryClaims,
  expandCategoryIdsWithDescendants,
  getAncestorIds,
  getRootCategoryId,
} from '@services/categories/category-hierarchy';
import { withTransaction } from '@services/common/with-transaction';
import { getSpendingsByCategories } from '@services/stats/get-spendings-by-categories';

import { createLine } from './create-line';
import { findPlan } from './find-plan';
import { createGroup } from './line-groups';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { currentPeriodStart } from './periods/period-enumerator';
import { type LineCandidate, hasGuidance, maxLinesFor, organizeLinesWithAi } from './suggested-lines-ai';
import { ownedCategoryIds } from './validate-line-categories';

const MAX_LINES = 8;
const HISTORY_MONTHS = 3;
const FOCUS_OPTIONS = 6;
const ROUND_UP_TO_CENTS = 1000;

const GROUPS = ['bills', 'everyday', 'life'] as const;
type SuggestedGroup = (typeof GROUPS)[number];

const GROUP_BY_ROOT_KEY: Record<string, SuggestedGroup> = {
  housing: 'bills',
  communication: 'bills',
  'financial-expenses': 'bills',
  food: 'everyday',
  transportation: 'everyday',
  vehicle: 'everyday',
  shopping: 'everyday',
  life: 'life',
  investments: 'life',
};
const EXCLUDED_ROOT_KEYS = new Set(['income', 'other']);

/** Keys repeat across parents (`lottery-gambling`), so entries match on the parent key too. */
const STARTER_TEMPLATE: { parentKey: string | null; key: string; group: SuggestedGroup }[] = [
  { parentKey: 'housing', key: 'rent', group: 'bills' },
  { parentKey: 'housing', key: 'energy-utilities', group: 'bills' },
  { parentKey: 'communication', key: 'phone-cell-phone', group: 'bills' },
  { parentKey: 'food', key: 'groceries', group: 'everyday' },
  { parentKey: 'food', key: 'restaurant', group: 'everyday' },
  { parentKey: null, key: 'transportation', group: 'everyday' },
  { parentKey: 'life', key: 'health-care-doctor', group: 'life' },
  { parentKey: 'shopping', key: 'free-time', group: 'life' },
];

/** Offered as the "what else do you spend on" choices when there is no history to rank by. */
const STARTER_FOCUS: { parentKey: string; key: string }[] = [
  { parentKey: 'shopping', key: 'kids' },
  { parentKey: 'life', key: 'active-sport-fitness' },
  { parentKey: 'life', key: 'holiday-trips-hotels' },
  { parentKey: 'life', key: 'hobbies' },
  { parentKey: 'shopping', key: 'gifts-joy' },
  { parentKey: 'life', key: 'education-development' },
];

const loadCategories = async ({ userId }: { userId: number }) => {
  const categories = await Categories.findAll({ where: { userId }, attributes: ['id', 'parentId', 'key', 'name'] });
  return { categories, byId: new Map<string, Categories>(categories.map((category) => [category.id, category])) };
};

const findByKey = ({
  categories,
  byId,
  parentKey,
  key,
}: {
  categories: Categories[];
  byId: Map<string, Categories>;
  parentKey: string | null;
  key: string;
}) =>
  categories.find(
    (entry) =>
      entry.key === key &&
      (parentKey === null ? entry.parentId === null : byId.get(entry.parentId ?? '')?.key === parentKey),
  );

interface Suggestion {
  category: Categories;
  group: SuggestedGroup | null;
  /** Spend filed directly on the category over the history window; ranks suggestions. */
  totalCents: number;
}

/** Expense cents per exact category over the full calendar months before the current one (UTC). */
const historySpend = async ({
  userId,
  accountIds,
  categories,
}: {
  userId: number;
  accountIds: RecordId[];
  categories: Categories[];
}) => {
  // An empty `accountIds` would widen the stats scope to every account.
  if (!accountIds.length) return {};

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return getSpendingsByCategories({
    userId,
    from: toUtcDateString(new Date(Date.UTC(year, month - HISTORY_MONTHS, 1))),
    to: toUtcDateString(new Date(Date.UTC(year, month, 0))),
    accountIds,
    // Selecting every category keeps each total on its own category instead of the root.
    categoryIds: categories.map((category) => category.id),
    transactionType: TRANSACTION_TYPES.expense,
    excludePlanned: true,
  });
};

/** Monthly average in the plan's cadence, rounded up to a whole 10. Integer math keeps the ceil exact. */
const toBaselineCents = ({ plan, totalCents }: { plan: BudgetPlans; totalCents: number }): number => {
  const monthsPerPeriod: Record<BudgetPlanCadence, [number, number]> = {
    months: [plan.intervalN, 1],
    semi_monthly: [1, 2],
    days: [plan.intervalN * 12, 365],
  };
  const [numerator, denominator] = monthsPerPeriod[plan.cadence];

  return Math.ceil((totalCents * numerator) / (HISTORY_MONTHS * denominator * ROUND_UP_TO_CENTS)) * ROUND_UP_TO_CENTS;
};

interface LineDraft {
  groupName: string | null;
  name: string;
  categoryIds: RecordId[];
  baselineCents: number;
}

/** Groups are matched by name, so a rerun or a group the user already made is reused. */
const writeLines = withTransaction(
  async ({
    userId,
    planId,
    drafts,
    origin,
  }: {
    userId: number;
    planId: RecordId;
    drafts: LineDraft[];
    origin: Exclude<BudgetLineOrigin, 'manual'>;
  }) => {
    const plan = await findPlan({ planId, userId, lock: true });
    const { periods, currentStart } = await ensureCurrentPeriods({ plan });
    const currentPeriod = periods.find((period) => toUtcDateString(period.startDate) === currentStart)!;

    for (const { groupName, name, categoryIds, baselineCents } of drafts) {
      const groupId =
        groupName === null
          ? null
          : ((await BudgetLineGroups.findOne({ where: { planId, name: groupName } }))?.id ??
            (await createGroup({ userId, planId, name: groupName })).id);
      const line = await createLine({ userId, planId, name, categoryIds, groupId, origin });
      if (baselineCents > 0) {
        await BudgetAssignments.create({
          periodId: currentPeriod.id,
          lineId: line.id,
          baselineAmount: Money.fromCents(baselineCents),
        });
      }
    }
  },
);

/** Top spending categories, or the starter set without history, ordered so groups are created in `GROUPS` order. */
const rulesPicks = ({
  categories,
  byId,
  spend,
  rootKeyOf,
  take,
  overlaps,
  maxLines,
}: {
  categories: Categories[];
  byId: Map<string, Categories>;
  spend: Awaited<ReturnType<typeof historySpend>>;
  maxLines: number;
  rootKeyOf: (params: { categoryId: string }) => string;
  take: (params: { categoryId: string }) => void;
  overlaps: (params: { categoryId: string }) => boolean;
}): Suggestion[] => {
  const history: Suggestion[] = Object.entries(spend)
    .flatMap(([categoryId, { amount }]) => {
      const rootKey = rootKeyOf({ categoryId });
      if (amount <= 0 || EXCLUDED_ROOT_KEYS.has(rootKey)) return [];
      return [{ category: byId.get(categoryId)!, totalCents: amount, group: GROUP_BY_ROOT_KEY[rootKey] ?? null }];
    })
    .toSorted((a, b) => b.totalCents - a.totalCents);

  const template: Suggestion[] = STARTER_TEMPLATE.flatMap(({ parentKey, key, group }) => {
    const category = findByKey({ categories, byId, parentKey, key });
    return category ? [{ category, group, totalCents: 0 }] : [];
  });

  const picks: Suggestion[] = [];
  for (const suggestion of history.length ? history : template) {
    if (picks.length === maxLines) break;
    if (overlaps({ categoryId: suggestion.category.id })) continue;

    take({ categoryId: suggestion.category.id });
    picks.push(suggestion);
  }

  const rank = ({ group }: Suggestion) => (group ? GROUPS.indexOf(group) : -1);
  return picks.toSorted((a, b) => rank(a) - rank(b));
};

/** A line covers its categories' whole subtrees; the expansion dedupes a parent listed with its child. */
const subtreeSpendCents = ({
  categoryIds,
  categories,
  byId,
  spend,
}: {
  categoryIds: string[];
  categories: Categories[];
  byId: Map<string, Categories>;
  spend: Awaited<ReturnType<typeof historySpend>>;
}) =>
  expandCategoryIdsWithDescendants({ categoryIds, categories, byId }).reduce(
    (sum, id) => sum + Math.max(spend[id]?.amount ?? 0, 0),
    0,
  );

const categoryPath = ({ category, byId }: { category: Categories; byId: Map<string, Categories> }): string =>
  [...getAncestorIds({ categoryId: category.id, byId }).toReversed(), category.id]
    .map((id) => byId.get(id)!.name)
    .join(' › ');

/**
 * Lines for the plan's spending categories, arranged by a model when one is
 * available and has spending or the user's answers to go on, and by spend rank
 * or a fixed starter set otherwise; the fallback honours only the answers'
 * detail level. Categories another line already covers, directly or through an
 * ancestor or descendant, are skipped. The model call runs before the plan lock
 * is taken; `createLine` rechecks overlaps under it.
 */
export const addSuggestedLines = async ({
  userId,
  planId,
  answers = {},
}: {
  userId: number;
  planId: RecordId;
  answers?: BudgetSuggestionAnswers;
}): Promise<AddSuggestedBudgetLinesResponse> => {
  const plan = await findPlan({ planId, userId });
  const currentStart = currentPeriodStart({ plan });

  const { categories, byId } = await loadCategories({ userId });
  const rootKeyOf = ({ categoryId }: { categoryId: string }) =>
    byId.get(getRootCategoryId({ categoryId, byId }))!.key ?? '';

  const { take, overlaps } = createCategoryClaims({ byId });
  for (const categoryId of await ownedCategoryIds({ planId: plan.id, range: { from: currentStart, until: null } })) {
    take({ categoryId });
  }

  const accountIds = (await BudgetPlanAccounts.findAll({ where: { planId: plan.id }, attributes: ['accountId'] })).map(
    (row) => row.accountId,
  );
  const spend = await historySpend({ userId, accountIds, categories });
  const subtreeCents = ({ categoryIds }: { categoryIds: string[] }) =>
    subtreeSpendCents({ categoryIds, categories, byId, spend });

  const candidates = categories.flatMap((category): LineCandidate[] =>
    EXCLUDED_ROOT_KEYS.has(rootKeyOf({ categoryId: category.id })) || overlaps({ categoryId: category.id })
      ? []
      : [
          {
            id: category.id,
            path: categoryPath({ category, byId }),
            totalCents: subtreeCents({ categoryIds: [category.id] }),
          },
        ],
  );

  const locale = requestContext.getLocale();
  const ai = await organizeLinesWithAi({
    userId,
    candidates,
    byId,
    locale,
    currencyCode: plan.currencyCode,
    answers,
  });

  const toDraft = ({ groupName, name, categoryIds }: Omit<LineDraft, 'baselineCents'>): LineDraft => ({
    groupName,
    name,
    categoryIds,
    baselineCents: toBaselineCents({ plan, totalCents: subtreeCents({ categoryIds }) }),
  });

  const drafts = ai
    ? ai.layout.groups.flatMap((group) => group.lines.map((line) => toDraft({ groupName: group.name, ...line })))
    : rulesPicks({
        categories,
        byId,
        spend,
        rootKeyOf,
        take,
        overlaps,
        maxLines: maxLinesFor({ detail: answers.detail, fallback: MAX_LINES }),
      }).map(({ category, group }) =>
        toDraft({
          groupName: group && t({ key: `budgetPlans.suggestedGroups.${group}`, locale }),
          name: category.name,
          categoryIds: [category.id],
        }),
      );
  if (!drafts.length) return { created: 0 };

  await writeLines({ userId, planId: plan.id, drafts, origin: ai ? 'ai' : 'rules' });

  trackEvent({
    userId,
    event: 'budget_suggestions_generated',
    properties: {
      source: ai ? 'ai' : 'rules',
      ...(ai && { model_id: ai.modelId }),
      lines: drafts.length,
      groups: new Set(drafts.flatMap(({ groupName }) => (groupName ? [groupName] : []))).size,
    },
  });
  return { created: drafts.length, ...(!ai && hasGuidance({ answers }) && { answersIgnored: true }) };
};

/**
 * What the setup questions need before a plan exists: whether the accounts have spending
 * to build on, and the categories to offer as focus choices.
 */
export const getSuggestionContext = async ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: RecordId[];
}): Promise<BudgetSuggestionContext> => {
  const { categories, byId } = await loadCategories({ userId });
  const spend = await historySpend({ userId, accountIds, categories });

  const topRoots = categories
    .filter((category) => category.parentId === null && !EXCLUDED_ROOT_KEYS.has(category.key ?? ''))
    .map(({ id }) => ({ id, totalCents: subtreeSpendCents({ categoryIds: [id], categories, byId, spend }) }))
    .filter(({ totalCents }) => totalCents > 0)
    .toSorted((a, b) => b.totalCents - a.totalCents)
    .slice(0, FOCUS_OPTIONS);

  if (topRoots.length) {
    return {
      hasHistory: true,
      categories: topRoots.map(({ id, totalCents }) => ({
        id,
        monthlyAvg: Money.fromCents(Math.round(totalCents / HISTORY_MONTHS)).toNumber(),
      })),
    };
  }

  return {
    hasHistory: false,
    categories: STARTER_FOCUS.flatMap(({ parentKey, key }) => {
      const category = findByKey({ categories, byId, parentKey, key });
      return category ? [{ id: category.id, monthlyAvg: null }] : [];
    }),
  };
};
