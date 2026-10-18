import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
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

type SpendingsByCategoriesParams = Omit<Parameters<typeof getSpendingsByCategories>[0], 'decimals'>;

/** Spendings per category in the base currency, of one transaction type. */
export const getSpendingsByCategoriesReport = async (params: SpendingsByCategoriesParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const spendings = await getSpendingsByCategories(removeUndefinedKeys({ ...params, decimals }));

  return serializeSpendingsByCategories({ spendings, decimals });
};

/** Income and expense per category in the base currency, in one response. */
export const getSpendingsByCategoriesByTypeReport = async (
  params: Omit<SpendingsByCategoriesParams, 'transactionType'>,
) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const spendings = await getSpendingsByCategoriesByType(removeUndefinedKeys({ ...params, decimals }));

  return serializeSpendingsByCategoriesByType({ spendings, decimals });
};

/** Income and expense per category in the base currency for every calendar month of the range. */
export const getMonthlySpendingsByCategoriesReport = async (
  params: Omit<Parameters<typeof getMonthlySpendingsByCategoriesByType>[0], 'decimals' | 'transactionType'>,
) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const months = await getMonthlySpendingsByCategoriesByType(removeUndefinedKeys({ ...params, decimals }));

  return months.map(({ month, categories }) => ({
    month,
    categories: serializeSpendingsByCategoriesByType({ spendings: categories, decimals }),
  }));
};
