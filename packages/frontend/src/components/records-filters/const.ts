import {
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';

/** Transfer kinds the user can narrow down to via the "Transfer nature" filter. */
export const SELECTABLE_TRANSFER_NATURES = [
  TRANSACTION_TRANSFER_NATURE.common_transfer,
  TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
  TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
  TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
] as const;

export interface FiltersStruct {
  start: Date | undefined; // ISO date
  end: Date | undefined; // ISO date
  transactionType: TRANSACTION_TYPES | null;
  amountGte: number | undefined;
  amountLte: number | undefined;
  transferFilter: FILTER_OPERATION;
  refundFilter: FILTER_OPERATION;
  plannedFilter: FILTER_OPERATION;
  /** Which transfer kinds to include. All selected = no narrowing. */
  transferNatures: TRANSACTION_TRANSFER_NATURE[];
  accountIds: string[];
  trackerIds: string[];
  excludedTrackerIds: string[];
  /** Free text matched against note, payee name and tag names. */
  search: string;
  noteIncludes: string;
  attachmentFilter: FILTER_OPERATION;
  categoryIds: string[];
  tagIds: string[];
  payeeIds: string[];
  categorizationSource: CATEGORIZATION_SOURCE | null;
  /** Exact import batch to scope to (deep link from Import History). Not user-editable via the filter UI. */
  batchId: string | null;
}

export const DEFAULT_FILTERS: FiltersStruct = {
  start: undefined,
  end: undefined,
  transactionType: null,
  amountGte: undefined,
  amountLte: undefined,
  transferFilter: FILTER_OPERATION.all,
  refundFilter: FILTER_OPERATION.all,
  plannedFilter: FILTER_OPERATION.all,
  transferNatures: [...SELECTABLE_TRANSFER_NATURES],
  accountIds: [],
  trackerIds: [],
  excludedTrackerIds: [],
  search: '',
  noteIncludes: '',
  attachmentFilter: FILTER_OPERATION.all,
  categoryIds: [],
  tagIds: [],
  payeeIds: [],
  categorizationSource: null,
  batchId: null,
};
