import type { FiltersStruct } from '@/components/records-filters/const';
import { format } from 'date-fns';

import type { ProvidedChatPageContext } from './use-chat-page-context';

/** A page context travels with every message and the server bounds its size; a list this long is a sample of the filter. */
const MAX_IDS_PER_FILTER = 50;
const DATE_FORMAT = 'yyyy-MM-dd';

/** The id filters, under the key names the server reads to drop ids the user does not own. */
const ID_FILTER_KEYS = ['accountIds', 'categoryIds', 'payeeIds', 'tagIds', 'trackerIds'] as const;

/**
 * What the transactions page shows, as a chat page context: the period and the filters that narrow the
 * list. Filters left at their defaults say nothing, so an unfiltered page has an empty context.
 */
export const buildTransactionsChatContext = ({ filters }: { filters: FiltersStruct }): ProvidedChatPageContext => {
  const context: ProvidedChatPageContext = {};

  if (filters.start && filters.end) {
    context.period = { from: format(filters.start, DATE_FORMAT), to: format(filters.end, DATE_FORMAT) };
  }

  const narrowing: Record<string, unknown> = {};
  for (const key of ID_FILTER_KEYS) {
    if (filters[key].length > 0) narrowing[key] = filters[key].slice(0, MAX_IDS_PER_FILTER);
  }
  if (filters.transactionType) narrowing.transactionType = filters.transactionType;
  if (filters.amountGte !== undefined) narrowing.amountGte = filters.amountGte;
  if (filters.amountLte !== undefined) narrowing.amountLte = filters.amountLte;
  if (filters.noteIncludes.trim() !== '') narrowing.noteIncludes = filters.noteIncludes.trim();

  if (Object.keys(narrowing).length > 0) context.filters = narrowing;
  return context;
};
