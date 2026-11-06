import { removeUndefinedKeys } from '@js/helpers';
import {
  serializeSpendingsByCategories,
  serializeSpendingsByCategoriesByType,
} from '@root/serializers/stats.serializer';

import {
  getMonthlySpendingsByCategoriesByType,
  getSpendingsByCategories,
  getSpendingsByCategoriesByType,
} from '../get-spendings-by-categories';

type SpendingsByCategoriesParams = Parameters<typeof getSpendingsByCategories>[0];

/** Spendings per category in the base currency, of one transaction type. */
export const getSpendingsByCategoriesReport = async (params: SpendingsByCategoriesParams) => {
  const spendings = await getSpendingsByCategories(removeUndefinedKeys(params));

  return serializeSpendingsByCategories(spendings);
};

/** Income and expense per category in the base currency, in one response. */
export const getSpendingsByCategoriesByTypeReport = async (
  params: Omit<SpendingsByCategoriesParams, 'transactionType'>,
) => {
  const spendings = await getSpendingsByCategoriesByType(removeUndefinedKeys(params));

  return serializeSpendingsByCategoriesByType(spendings);
};

/** Income and expense per category in the base currency for every calendar month of the range. */
export const getMonthlySpendingsByCategoriesReport = async (
  params: Omit<Parameters<typeof getMonthlySpendingsByCategoriesByType>[0], 'transactionType'>,
) => {
  const months = await getMonthlySpendingsByCategoriesByType(removeUndefinedKeys(params));

  return months.map(({ month, categories }) => ({
    month,
    categories: serializeSpendingsByCategoriesByType(categories),
  }));
};
