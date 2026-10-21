import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useTagsStore } from '@/stores/tags';
import type { ChatEntityKind, ChatProposalCard } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';

/** What an entity's queries are found by: a global prefix anywhere in the key, or a key to start with. */
interface InvalidationTarget {
  prefixes?: readonly string[];
  keys?: ReadonlyArray<readonly string[]>;
}

type InvalidationPlan = { all: true } | { all: false; prefixes: string[]; keys: Array<readonly string[]> };

const { transactionChange, securityPriceChange, ventureChange, bankConnectionChange, currencies, notifications } =
  VUE_QUERY_GLOBAL_PREFIXES;

const TRANSACTIONS: InvalidationTarget = { prefixes: [transactionChange] };
const PORTFOLIOS: InvalidationTarget = { prefixes: [securityPriceChange, transactionChange] };
const VENTURE: InvalidationTarget = { prefixes: [ventureChange] };

/**
 * The queries each entity feeds. An entity missing here is not mapped on purpose: whatever it touches
 * is unknown, so a change to it invalidates everything rather than leaving a screen stale.
 */
const TARGETS: Partial<Record<ChatEntityKind, InvalidationTarget>> = {
  transaction: TRANSACTIONS,
  split: TRANSACTIONS,
  transactionGroup: TRANSACTIONS,
  transactionAutomation: TRANSACTIONS,
  importBatch: TRANSACTIONS,
  attachment: { prefixes: [transactionChange], keys: [VUE_QUERY_CACHE_KEYS.transactionAttachments] },
  transactionTemplate: { keys: [VUE_QUERY_CACHE_KEYS.transactionTemplatesList] },
  account: PORTFOLIOS,
  accountGroup: TRANSACTIONS,
  category: {
    prefixes: [transactionChange],
    keys: [VUE_QUERY_CACHE_KEYS.categoriesList, VUE_QUERY_CACHE_KEYS.categoriesByAccount],
  },
  tag: TRANSACTIONS,
  payee: {
    prefixes: [transactionChange],
    keys: [
      VUE_QUERY_CACHE_KEYS.payeesList,
      VUE_QUERY_CACHE_KEYS.payeesLookup,
      VUE_QUERY_CACHE_KEYS.payeesByAccount,
      VUE_QUERY_CACHE_KEYS.payeeById,
      VUE_QUERY_CACHE_KEYS.payeesIgnoredNames,
    ],
  },
  payeeAlias: {
    prefixes: [transactionChange],
    keys: [
      VUE_QUERY_CACHE_KEYS.payeesList,
      VUE_QUERY_CACHE_KEYS.payeesLookup,
      VUE_QUERY_CACHE_KEYS.payeeById,
      VUE_QUERY_CACHE_KEYS.payeesIgnoredNames,
    ],
  },
  tracker: {
    prefixes: [transactionChange],
    keys: [VUE_QUERY_CACHE_KEYS.trackersList, VUE_QUERY_CACHE_KEYS.trackersListItem],
  },
  trackerLine: {
    prefixes: [transactionChange],
    keys: [VUE_QUERY_CACHE_KEYS.trackersList, VUE_QUERY_CACHE_KEYS.trackersListItem],
  },
  budgetPlan: TRANSACTIONS,
  budgetPlanGroup: TRANSACTIONS,
  budgetPlanLine: TRANSACTIONS,
  budgetPlanLineGoal: TRANSACTIONS,
  subscription: TRANSACTIONS,
  loan: TRANSACTIONS,
  vehicle: TRANSACTIONS,
  portfolio: PORTFOLIOS,
  holding: PORTFOLIOS,
  investmentTransaction: PORTFOLIOS,
  portfolioTransfer: PORTFOLIOS,
  customCurrency: { prefixes: [currencies, transactionChange] },
  userCurrency: { prefixes: [currencies, transactionChange] },
  exchangeRate: { prefixes: [currencies, transactionChange] },
  venturePlatform: VENTURE,
  ventureDeal: VENTURE,
  ventureEvent: VENTURE,
  ventureEventLink: { prefixes: [ventureChange, transactionChange] },
  bankConnection: { prefixes: [bankConnectionChange] },
  notification: { prefixes: [notifications] },
};

const startsWith = ({ queryKey, key }: { queryKey: readonly unknown[]; key: readonly string[] }) =>
  key.every((part, index) => queryKey[index] === part);

/** The queries to refresh after changes to entities of these `kinds`; everything when one is not mapped. */
export const planInvalidation = ({ kinds }: { kinds: ChatEntityKind[] }): InvalidationPlan => {
  const prefixes = new Set<string>();
  const keys: Array<readonly string[]> = [];

  for (const kind of new Set(kinds)) {
    const target = TARGETS[kind];
    if (!target) return { all: true };

    target.prefixes?.forEach((prefix) => prefixes.add(prefix));
    for (const key of target.keys ?? []) {
      if (!keys.some((known) => known.length === key.length && startsWith({ queryKey: known, key }))) keys.push(key);
    }
  }

  return { all: false, prefixes: [...prefixes], keys };
};

/**
 * Whether a query belongs to the plan. Global prefixes are matched anywhere in the key because some
 * keys carry several (`[transactionChange, securityPriceChange, …]`); a plain key is matched from the start.
 */
export const matchesInvalidationPlan = ({
  plan,
  queryKey,
}: {
  plan: InvalidationPlan;
  queryKey: readonly unknown[];
}): boolean =>
  plan.all ||
  plan.prefixes.some((prefix) => queryKey.includes(prefix)) ||
  plan.keys.some((key) => startsWith({ queryKey, key }));

/** The entity kinds an applied card changed: its own and every kind it created or touched. */
const kindsOf = ({ card }: { card: ChatProposalCard }): ChatEntityKind[] => [
  card.entity,
  ...(card.result?.refs ?? []).map((ref) => ref.kind),
];

/**
 * Refreshes what an approval changed. The response of an approval lists every card of the chain, so
 * this looks at the applied ones. Categories and tags also live in stores that keep their own copy.
 */
export const useApplyInvalidation = () => {
  const queryClient = useQueryClient();

  const invalidateForCards = async ({ cards }: { cards: ChatProposalCard[] }): Promise<void> => {
    const kinds = cards.filter((card) => card.status === 'applied').flatMap((card) => kindsOf({ card }));
    if (kinds.length === 0) return;

    const plan = planInvalidation({ kinds });
    const reloads: Array<Promise<unknown>> = [
      plan.all
        ? queryClient.invalidateQueries()
        : queryClient.invalidateQueries({
            predicate: (query) => matchesInvalidationPlan({ plan, queryKey: query.queryKey }),
          }),
    ];

    const kindSet = new Set(kinds);
    if (kindSet.has('category')) reloads.push(useCategoriesStore().loadCategories({ force: true }));
    if (kindSet.has('tag')) reloads.push(useTagsStore().loadTags());

    await Promise.all(reloads);
  };

  return { invalidateForCards };
};
