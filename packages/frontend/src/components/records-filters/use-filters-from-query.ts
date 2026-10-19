import { FiltersStruct } from '@/components/records-filters/const';
import { FILTER_OPERATION, TRANSACTION_TYPES } from '@bt/shared/types';
import { endOfDay, parseISO } from 'date-fns';
import { LocationQuery } from 'vue-router';

const VALID_FILTER_OPERATIONS = new Set<string>(Object.values(FILTER_OPERATION));

function parseFilterOperation(value: string | undefined): FILTER_OPERATION | undefined {
  if (value && VALID_FILTER_OPERATIONS.has(value)) {
    return value as FILTER_OPERATION;
  }
  return undefined;
}

/**
 * Parses route query parameters into a partial FiltersStruct.
 * Returns only the filters that are present in the query.
 */
export const useFiltersFromQuery = () => {
  const parseFiltersFromQuery = ({ query }: { query: LocationQuery }): Partial<FiltersStruct> | null => {
    if (Object.keys(query).length === 0) {
      return null;
    }

    const filters: Partial<FiltersStruct> = {};

    if (query.categoryIds) {
      filters.categoryIds = Array.isArray(query.categoryIds)
        ? (query.categoryIds as string[])
        : [query.categoryIds as string];
    }

    if (query.accountIds) {
      filters.accountIds = Array.isArray(query.accountIds)
        ? (query.accountIds as string[])
        : [query.accountIds as string];
    }

    if (query.budgetIds) {
      filters.budgetIds = Array.isArray(query.budgetIds) ? (query.budgetIds as string[]) : [query.budgetIds as string];
    }

    if (query.start) {
      filters.start = parseISO(query.start as string);
    }

    if (query.end) {
      // Use endOfDay to include all transactions on the end date
      // Without this, "2025-12-31" becomes midnight which in UTC+X timezones
      // results in "2025-12-30T23:00:00Z", missing the last day's transactions
      filters.end = endOfDay(parseISO(query.end as string));
    }

    if (query.transactionType) {
      const type = query.transactionType as string;
      if (Object.values(TRANSACTION_TYPES).includes(type as TRANSACTION_TYPES)) {
        filters.transactionType = type as TRANSACTION_TYPES;
      }
    }

    if (query.amountGte) {
      filters.amountGte = Number(query.amountGte);
    }

    if (query.amountLte) {
      filters.amountLte = Number(query.amountLte);
    }

    if (query.noteIncludes) {
      filters.noteIncludes = query.noteIncludes as string;
    }

    if (query.batchId) {
      filters.batchId = query.batchId as string;
    }

    const transferFilter = parseFilterOperation(query.transferFilter as string | undefined);
    if (transferFilter) {
      filters.transferFilter = transferFilter;
    }

    const refundFilter = parseFilterOperation(query.refundFilter as string | undefined);
    if (refundFilter) {
      filters.refundFilter = refundFilter;
    }

    const plannedFilter = parseFilterOperation(query.plannedFilter as string | undefined);
    if (plannedFilter) {
      filters.plannedFilter = plannedFilter;
    }

    return Object.keys(filters).length > 0 ? filters : null;
  };

  return { parseFiltersFromQuery };
};
