import { type FiltersStruct, SELECTABLE_TRANSFER_NATURES } from '@/components/records-filters/const';
import { FILTER_OPERATION } from '@bt/shared/types';
import { format } from 'date-fns';

import type { ProvidedChatPageContext } from './use-chat-page-context';

/** A page context travels with every message and the server bounds its size; a list this long is a sample of the filter. */
const MAX_IDS_PER_FILTER = 50;
const DATE_FORMAT = 'yyyy-MM-dd';

/** The id filters, under the key names the server reads to drop ids the user does not own. */
const ID_FILTER_KEYS = ['accountIds', 'categoryIds', 'payeeIds', 'tagIds', 'trackerIds', 'excludedTrackerIds'] as const;

/** The include/exclude/only filters; `all` is their default and narrows nothing. */
const OPERATION_FILTER_KEYS = ['transferFilter', 'refundFilter', 'plannedFilter', 'attachmentFilter'] as const;

/**
 * What the transactions page shows, as a chat page context: the period and the filters that narrow the
 * list. Filters left at their defaults say nothing, so an unfiltered page has an empty context. The
 * import batch of a deep link is left out: the server cannot check that the user owns it.
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
  if (filters.search.trim() !== '') narrowing.search = filters.search.trim();
  for (const key of OPERATION_FILTER_KEYS) {
    if (filters[key] !== FILTER_OPERATION.all) narrowing[key] = filters[key];
  }
  if (filters.transferNatures.length < SELECTABLE_TRANSFER_NATURES.length) {
    narrowing.transferNatures = filters.transferNatures;
  }
  if (filters.categorizationSource) narrowing.categorizationSource = filters.categorizationSource;

  if (Object.keys(narrowing).length > 0) context.filters = narrowing;
  return context;
};
