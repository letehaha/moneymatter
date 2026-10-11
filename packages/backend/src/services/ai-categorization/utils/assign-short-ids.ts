import { createShortIds } from '@services/ai/short-ids';

import { CategoryForCategorization, TransactionForCategorization } from '../types';

/** Aliases sent to the model in place of UUIDs, plus maps to translate its answer back. */
interface ShortIdMapping {
  aliasedTransactions: TransactionForCategorization[];
  aliasedCategories: CategoryForCategorization[];
  transactionIdByAlias: Map<string, string>;
  categoryIdByAlias: Map<string, string>;
}

/**
 * Replace UUIDs with "t1"/"c1" aliases numbered in input order. A UUID costs ~20
 * tokens and each transaction carries three of them per run. The distinct prefixes
 * keep the namespaces disjoint, so a line with swapped sides fails validation.
 */
export function assignShortIds({
  transactions,
  categories,
}: {
  transactions: TransactionForCategorization[];
  categories: CategoryForCategorization[];
}): ShortIdMapping {
  const transactionIds = createShortIds({ ids: transactions.map((transaction) => transaction.id), prefix: 't' });
  const categoryIds = createShortIds({ ids: categories.map((category) => category.id), prefix: 'c' });

  const aliasedTransactions = transactions.map((transaction) => ({
    ...transaction,
    id: transactionIds.aliasOf({ id: transaction.id })!,
  }));

  const aliasedCategories = categories.map((category) => ({
    ...category,
    id: categoryIds.aliasOf({ id: category.id })!,
    // A parent outside the list has no alias; presenting the category as
    // top-level beats leaking a raw UUID into the prompt.
    parentId: category.parentId ? (categoryIds.aliasOf({ id: category.parentId }) ?? null) : null,
  }));

  return {
    aliasedTransactions,
    aliasedCategories,
    transactionIdByAlias: transactionIds.idByAlias,
    categoryIdByAlias: categoryIds.idByAlias,
  };
}
