import { type CategoryNode, collectSubtreeIds, getAncestors } from '@/common/utils/category-tree';
import type { Period } from '@/composable/use-period-navigation';
import { ROUTES_NAMES } from '@/routes/constants';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { RouteLocationNamedRaw } from 'vue-router';

export type MoneyFlowNodeKind = 'income' | 'expense' | 'tax' | 'savings';

/**
 * Transactions page filtered to the categories a node's amount covers, or null for nodes that are not categories.
 * A node above `level` (the depth its column rolls up to) holds only its own direct amount, not its subtree.
 */
export const buildNodeTransactionsLink = ({
  nodeId,
  kind,
  level = 1,
  categories,
  period,
  taxCategoryIds = [],
  savingsCategoryIds = [],
}: {
  nodeId: string;
  kind: MoneyFlowNodeKind;
  level?: number;
  categories: CategoryNode[];
  period: Period;
  taxCategoryIds?: string[];
  savingsCategoryIds?: string[];
}): RouteLocationNamedRaw | null => {
  if (!categories.some((c) => c.id === nodeId)) return null;
  const ownOnly =
    level > 1 &&
    getAncestors({ id: nodeId, categoriesMap: Object.fromEntries(categories.map((c) => [c.id, c])) }).length + 1 <
      level;
  // Savings categories count toward no other node; tax categories leave only the expense side.
  const excludedIds = {
    income: savingsCategoryIds,
    expense: [...savingsCategoryIds, ...taxCategoryIds],
    tax: savingsCategoryIds,
    savings: [],
  }[kind];
  return {
    name: ROUTES_NAMES.transactions,
    query: {
      categoryIds: ownOnly ? [nodeId] : collectSubtreeIds({ rootId: nodeId, categories, excludedIds }),
      start: period.from.toISOString(),
      end: period.to.toISOString(),
      // Savings legs net both directions, so they stay unfiltered by type.
      ...(kind !== 'savings' && {
        transactionType: kind === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
      }),
    },
  };
};
