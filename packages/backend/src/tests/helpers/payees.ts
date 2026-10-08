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

import { makeRequest } from './common';

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

export type PayeeWithStats = PayeeModel & { stats: PayeeStats | null };

export async function createPayee<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: CreatePayeePayload;
  raw?: R;
}) {
  return makeRequest<PayeeModel, R>({
    method: 'post',
    url: '/payees',
    payload,
    raw,
  });
}

export async function listPayees<R extends boolean | undefined = undefined>({
  q,
  accountId,
  sortBy,
  sortDir,
  raw,
}: {
  q?: string;
  accountId?: string;
  sortBy?: PayeeSortBy;
  sortDir?: PayeeSortDir;
  raw?: R;
} = {}) {
  const search = new URLSearchParams();
  if (q !== undefined) search.set('q', q);
  if (accountId !== undefined) search.set('accountId', accountId);
  if (sortBy !== undefined) search.set('sortBy', sortBy);
  if (sortDir !== undefined) search.set('sortDir', sortDir);
  const qs = search.toString();
  return makeRequest<PayeeWithStats[], R>({
    method: 'get',
    url: `/payees${qs ? `?${qs}` : ''}`,
    raw,
  });
}

export async function lookupPayees<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<PayeeLookupItem[], R>({
    method: 'get',
    url: '/payees/lookup',
    raw,
  });
}

export async function getPayeeById<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<PayeeWithStats, R>({
    method: 'get',
    url: `/payees/${id}`,
    raw,
  });
}

export async function updatePayee<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: UpdatePayeePayload;
  raw?: R;
}) {
  return makeRequest<PayeeModel, R>({
    method: 'patch',
    url: `/payees/${id}`,
    payload,
    raw,
  });
}

export async function deletePayee<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<void, R>({
    method: 'delete',
    url: `/payees/${id}`,
    raw,
  });
}

export async function mergePayees<R extends boolean | undefined = undefined>({
  sourceId,
  targetId,
  raw,
}: {
  sourceId: string;
  targetId: string;
  raw?: R;
}) {
  return makeRequest<PayeeModel, R>({
    method: 'post',
    url: `/payees/${sourceId}/merge`,
    payload: { targetPayeeId: targetId },
    raw,
  });
}

export async function createPayeeAlias<R extends boolean | undefined = undefined>({
  payeeId,
  rawName,
  raw,
}: {
  payeeId: string;
  rawName: string;
  raw?: R;
}) {
  return makeRequest<PayeeModel, R>({
    method: 'post',
    url: `/payees/${payeeId}/aliases`,
    payload: { rawName },
    raw,
  });
}

export async function deletePayeeAlias<R extends boolean | undefined = undefined>({
  payeeId,
  aliasId,
  raw,
}: {
  payeeId: string;
  aliasId: string;
  raw?: R;
}) {
  return makeRequest<void, R>({
    method: 'delete',
    url: `/payees/${payeeId}/aliases/${aliasId}`,
    raw,
  });
}

export async function applyPayeeTagsToExisting<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<{ updatedTransactionsCount: number }, R>({
    method: 'post',
    url: `/payees/${id}/apply-tags`,
    raw,
  });
}

export function buildPayeePayload(overrides: Partial<CreatePayeePayload> = {}): CreatePayeePayload {
  return {
    name: `Test Payee ${Date.now()}`,
    ...overrides,
  };
}

export interface IgnoredNameRow {
  id: string;
  normalizedName: string;
  rawSample: string | null;
  createdAt: string;
}

export async function listIgnoredNames<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<IgnoredNameRow[], R>({
    method: 'get',
    url: '/payees/ignored-names',
    raw,
  });
}

export async function addIgnoredName<R extends boolean | undefined = undefined>({
  rawName,
  force,
  raw,
}: {
  rawName: string;
  force?: boolean;
  raw?: R;
}) {
  return makeRequest<IgnoredNameRow, R>({
    method: 'post',
    url: '/payees/ignored-names',
    payload: { rawName, force },
    raw,
  });
}

export async function removeIgnoredName<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<void, R>({
    method: 'delete',
    url: `/payees/ignored-names/${id}`,
    raw,
  });
}

export async function deletePayeeAndIgnore<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<{ ignoredAddedCount: number }, R>({
    method: 'delete',
    url: `/payees/${id}?ignoreFuture=true`,
    raw,
  });
}

export async function bulkDeletePayees<R extends boolean | undefined = undefined>({
  ids,
  ignoreFuture,
  raw,
}: {
  ids: string[];
  ignoreFuture?: boolean;
  raw?: R;
}) {
  return makeRequest<{ deletedCount: number; ignoredAddedCount: number }, R>({
    method: 'post',
    url: '/payees/bulk-delete',
    payload: { ids, ignoreFuture },
    raw,
  });
}

export async function bulkUpdatePayeeCategorizationMode<R extends boolean | undefined = undefined>({
  mode,
  raw,
}: {
  mode: CATEGORIZATION_MODE;
  raw?: R;
}) {
  return makeRequest<{ updatedCount: number }, R>({
    method: 'patch',
    url: '/payees/bulk-categorization-mode',
    payload: { mode },
    raw,
  });
}

export async function resetPayeeLogo<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<PayeeModel, R>({
    method: 'post',
    url: `/payees/${id}/reset-logo`,
    raw,
  });
}
