import { api } from '@/api/_api';
import {
  CATEGORIZATION_MODE,
  EntityLogoPayload,
  PayeeLookupItem,
  PayeeModel,
  PayeeSortBy,
  PayeeSortDir,
  PayeeStats,
  TransactionLocation,
} from '@bt/shared/types';

export type PayeeWithStats = PayeeModel & { stats: PayeeStats | null };

export interface CreatePayeePayload extends EntityLogoPayload {
  name: string;
  defaultCategoryId?: string | null;
  categorizationMode?: CATEGORIZATION_MODE;
  defaultTagIds?: string[];
  defaultLocation?: TransactionLocation | null;
}

export interface UpdatePayeePayload extends EntityLogoPayload {
  name?: string;
  defaultCategoryId?: string | null;
  categorizationMode?: CATEGORIZATION_MODE;
  defaultTagIds?: string[];
  defaultLocation?: TransactionLocation | null;
}

export type { PayeeSortBy, PayeeSortDir } from '@bt/shared/types';

interface ListPayeesParams {
  q?: string;
  limit?: number;
  offset?: number;
  sortBy?: PayeeSortBy;
  sortDir?: PayeeSortDir;
  accountId?: string;
}

export const loadPayees = async (params: ListPayeesParams = {}): Promise<PayeeWithStats[]> => {
  const search = new URLSearchParams();
  if (params.q !== undefined) search.set('q', params.q);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.sortBy !== undefined) search.set('sortBy', params.sortBy);
  if (params.sortDir !== undefined) search.set('sortDir', params.sortDir);
  if (params.accountId !== undefined) search.set('accountId', params.accountId);
  const qs = search.toString();
  return api.get(`/payees${qs ? `?${qs}` : ''}`);
};

/**
 * Mirror of `loadCategoriesByAccount` – used by the transaction-form payee
 * picker on a shared account so it resolves to the account owner's payee
 * namespace (matching the backend write paths' validation scope).
 */
export const loadPayeesByAccount = async ({
  accountId,
  q,
  sortBy,
  sortDir,
}: {
  accountId: string;
  q?: string;
  sortBy?: PayeeSortBy;
  sortDir?: PayeeSortDir;
}): Promise<PayeeWithStats[]> => loadPayees({ accountId, q, sortBy, sortDir });

export const loadPayeeById = async ({ id }: { id: string }): Promise<PayeeWithStats> => {
  return api.get(`/payees/${id}`);
};

/**
 * Lightweight id → name/logo map for ALL payees (no stats, no pagination). Backs
 * beneficiary-column resolution where the truncated top-50 `loadPayees` list would
 * leave payees past the cutoff unresolved.
 */
export const loadPayeeLookup = async (): Promise<PayeeLookupItem[]> => {
  return api.get('/payees/lookup');
};

export const createPayee = async (payload: CreatePayeePayload): Promise<PayeeModel> => {
  return api.post('/payees', payload);
};

export const updatePayee = async ({
  id,
  payload,
}: {
  id: string;
  payload: UpdatePayeePayload;
}): Promise<PayeeModel> => {
  return api.patch(`/payees/${id}`, payload);
};

export const deletePayee = async ({ id }: { id: string }): Promise<void> => {
  return api.delete(`/payees/${id}`, {});
};

export const deletePayeeAndIgnore = async ({ id }: { id: string }): Promise<{ ignoredAddedCount: number }> => {
  return api.delete(`/payees/${id}?ignoreFuture=true`, {});
};

export const bulkDeletePayees = async ({
  ids,
  ignoreFuture,
}: {
  ids: string[];
  ignoreFuture: boolean;
}): Promise<{ deletedCount: number; ignoredAddedCount: number }> => {
  return api.post('/payees/bulk-delete', { ids, ignoreFuture });
};

export interface IgnoredName {
  id: string;
  normalizedName: string;
  rawSample: string | null;
  createdAt: string;
}

export const listIgnoredNames = async (): Promise<IgnoredName[]> => {
  return api.get('/payees/ignored-names');
};

export const addIgnoredName = async ({
  rawName,
  force,
}: {
  rawName: string;
  force?: boolean;
}): Promise<IgnoredName> => {
  return api.post('/payees/ignored-names', { rawName, force });
};

export const removeIgnoredName = async ({ id }: { id: string }): Promise<void> => {
  return api.delete(`/payees/ignored-names/${id}`, {});
};

export const applyPayeeTagsToExisting = async ({
  id,
}: {
  id: string;
}): Promise<{ updatedTransactionsCount: number }> => {
  return api.post(`/payees/${id}/apply-tags`, {});
};

export const mergePayees = async ({
  sourceId,
  targetPayeeId,
}: {
  sourceId: string;
  targetPayeeId: string;
}): Promise<PayeeModel> => {
  return api.post(`/payees/${sourceId}/merge`, { targetPayeeId });
};

export const createPayeeAlias = async ({
  payeeId,
  rawName,
}: {
  payeeId: string;
  rawName: string;
}): Promise<PayeeModel> => {
  return api.post(`/payees/${payeeId}/aliases`, { rawName });
};

export const deletePayeeAlias = async ({ payeeId, aliasId }: { payeeId: string; aliasId: string }): Promise<void> => {
  return api.delete(`/payees/${payeeId}/aliases/${aliasId}`, {});
};

export const bulkUpdateCategorizationMode = async ({
  mode,
}: {
  mode: CATEGORIZATION_MODE;
}): Promise<{ updatedCount: number }> => {
  return api.patch('/payees/bulk-categorization-mode', { mode });
};

export const resetPayeeLogo = async ({ id }: { id: string }): Promise<PayeeModel> => {
  return api.post(`/payees/${id}/reset-logo`, {});
};
