import { api } from '@/api/_api';
import { TransactionModel } from '@bt/shared/types/db-models';
import * as endpointsTypes from '@bt/shared/types/endpoints';
import {
  ACCOUNT_TYPES,
  FILTER_OPERATION,
  SORT_DIRECTIONS,
  TRANSACTION_SORT_FIELD,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types/enums';

const formatTransactionPayload = <
  T extends endpointsTypes.CreateTransactionBody | endpointsTypes.UpdateTransactionBody,
>(
  transaction: T,
): T => {
  const params = { ...transaction } as Record<string, unknown>;
  const timeFieldsToPatch = ['time'];

  timeFieldsToPatch.forEach((field) => {
    if (params[field]) params[field] = new Date(params[field] as string).toISOString();
  });

  return params as T;
};

export const loadTransactions = async ({
  from,
  to,
  ...params
}: {
  /** Pagination row offset. */
  offset?: number;
  limit?: number;
  budgetIds?: string[];
  excludedBudgetIds?: string[];
  accountType?: ACCOUNT_TYPES;
  transactionType?: TRANSACTION_TYPES;
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  payeeIds?: string[];
  categorizationSource?: string;
  /** Exact `categorizationMeta.categorizedAt` stamp — pairs with `categorizationSource` to fetch one AI run. */
  categorizedAt?: string;
  /** Exact `externalData.importDetails.batchId` stamp — filters to one import batch. */
  batchId?: string;
  order?: SORT_DIRECTIONS;
  sortBy?: TRANSACTION_SORT_FIELD;
  excludeTransfer?: boolean;
  excludeRefunds?: boolean;
  /** Excludes transactions that are the refund side of a refund link (they cannot be linked again). */
  excludeRefundTxs?: boolean;
  /** With `excludeRefundTxs`: keep refunds linked to this transaction visible. */
  keepRefundsForTxId?: string;
  /** Hide transactions created by the balance-adjustment flow. */
  excludeBalanceAdjustments?: boolean;
  excludeAccountIds?: string[];
  transferFilter?: FILTER_OPERATION;
  refundFilter?: FILTER_OPERATION;
  /** Exact set of transferNature values to include. Supersedes transferFilter backend-side. */
  transferNatures?: TRANSACTION_TRANSFER_NATURE[];
  /** Date-range lower bound (inclusive). */
  from?: string;
  /** Date-range upper bound (inclusive). */
  to?: string;
  amountLte?: number;
  amountGte?: number;
  /** Case-insensitive substring match on the note field. Comma-separated terms are OR-ed. */
  noteSearch?: string;
  includeSplits?: boolean;
  includeTags?: boolean;
  includeGroups?: boolean;
  /** true = only planned rows, false = exclude them, absent = both. */
  isPlanned?: boolean;
  /** true = only rows with attachments, false = only rows without, absent = both. */
  hasAttachment?: boolean;
}): Promise<endpointsTypes.GetTransactionsResponse> => {
  return api.get('/transactions', {
    ...params,
    // The client drops falsy query values, which would swallow `isPlanned: false`.
    // Stringifying keeps the "exclude planned" intent on the wire.
    isPlanned: params.isPlanned === undefined ? undefined : String(params.isPlanned),
    hasAttachment: params.hasAttachment === undefined ? undefined : String(params.hasAttachment),
    includeHasAttachments: true,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });
};

export const loadPlannedSummary = async (): Promise<endpointsTypes.GetPlannedSummaryResponse> => {
  return api.get('/transactions/planned-summary');
};

export const loadTransactionsByTransferId = async (transferId: string): Promise<TransactionModel[]> => {
  return api.get(`/transactions/transfer/${transferId}`);
};

/** Single-tx fetch used by the edit dialog when the parent account isn't in the
 *  caller's local `accountsRecord` (typically the budget-share-only case). The list
 *  endpoints skip `canEdit` to keep the common path cheap; this lookup exposes it
 *  for free from the already-resolved access result on the server. */
export const loadTransactionById = async ({ id }: { id: string }): Promise<TransactionModel | null> => {
  return api.get(`/transactions/${id}`);
};

export const loadTransactionsByIds = async ({ ids }: { ids: string[] }): Promise<TransactionModel[]> => {
  return api.get('/transactions/by-ids', { ids: ids.join(',') });
};

export const createTransaction = async (params: endpointsTypes.CreateTransactionBody) => {
  const formattedParams = formatTransactionPayload({
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    note: '',
    ...params,
  });

  return api.post('/transactions', formattedParams);
};

export const editTransaction = async ({
  txId,
  ...rest
}: endpointsTypes.UpdateTransactionBody & { txId: string }): Promise<void> => {
  const params = formatTransactionPayload(rest);

  await api.put(`/transactions/${txId}`, params);
};

export const deleteTransaction = async (txId: string): Promise<void> => {
  await api.delete(`/transactions/${txId}`);
};

export const linkTransactions = async (payload: endpointsTypes.LinkTransactionsBody): Promise<void> => {
  await api.put('/transactions/link', payload);
};

export const unlinkTransactions = async (payload: endpointsTypes.UnlinkTransferTransactionsBody): Promise<void> => {
  await api.put('/transactions/unlink', payload);
};

export const bulkUpdateTransactions = async (
  payload: endpointsTypes.BulkUpdateTransactionsBody,
): Promise<endpointsTypes.BulkUpdateTransactionsResponse> => {
  return api.put('/transactions/bulk', payload);
};

export const bulkDeleteTransactions = async (
  payload: endpointsTypes.BulkDeleteTransactionsBody,
): Promise<endpointsTypes.BulkDeleteTransactionsResponse> => {
  return api.post('/transactions/bulk-delete', payload);
};

export const reconciliationRemove = async (
  payload: endpointsTypes.ReconciliationRemoveBody,
): Promise<endpointsTypes.ReconciliationActionResponse> => {
  return api.post('/transactions/reconciliation/remove', payload);
};

export const reconciliationMerge = async (
  payload: endpointsTypes.ReconciliationMergeBody,
): Promise<endpointsTypes.ReconciliationActionResponse> => {
  return api.post('/transactions/reconciliation/merge', payload);
};

export const reconciliationRestore = async (
  payload: endpointsTypes.ReconciliationRestoreBody,
): Promise<endpointsTypes.ReconciliationRestoreResponse> => {
  return api.post('/transactions/reconciliation/restore', payload);
};

export const loadReconciliationHistory = async (): Promise<endpointsTypes.ReconciliationHistoryEvent[]> => {
  return api.get('/transactions/reconciliation/history');
};

export const loadStuckPending = async (): Promise<endpointsTypes.StuckPendingItem[]> => {
  return api.get('/transactions/reconciliation/stuck-pending');
};

export const checkStuckPending = async (
  payload: endpointsTypes.CheckStuckPendingBody,
): Promise<endpointsTypes.CheckStuckPendingResponse> => {
  return api.post('/transactions/reconciliation/stuck-pending/check', payload);
};

export const keepAsBooked = async (
  payload: endpointsTypes.KeepAsBookedBody,
): Promise<endpointsTypes.KeepAsBookedResponse> => {
  return api.post('/transactions/reconciliation/keep-as-booked', payload);
};

export const loadRefundRecommendations = async (
  params: { transactionId: string } | { transactionType: TRANSACTION_TYPES; originAmount: number; accountId: string },
): Promise<endpointsTypes.GetRefundRecommendationsResponse> => {
  return api.get('/transactions/refund-recommendations', params);
};

export const loadTransferRecommendations = async (
  params: { transactionId: string } | { transactionType: TRANSACTION_TYPES; originAmount: number; accountId: string },
): Promise<endpointsTypes.GetTransferRecommendationsResponse> => {
  return api.get('/transactions/transfer-recommendations', params);
};

export const bulkScanTransferRecommendations = async (
  params: endpointsTypes.BulkTransferScanBody,
): Promise<endpointsTypes.BulkTransferScanResponse> => {
  return api.post('/transactions/transfer-recommendations/bulk-scan', params);
};

export const dismissTransferSuggestion = async (
  params: endpointsTypes.DismissTransferSuggestionBody,
): Promise<void> => {
  await api.post('/transactions/transfer-recommendations/dismiss', params);
};
