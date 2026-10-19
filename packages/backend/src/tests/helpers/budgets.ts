import {
  BUDGET_TYPES,
  BudgetModel,
  type EntityLogoWritePayload,
  RESOURCE_TYPES,
  type SharePermission,
  type BudgetSpendingStatsResponse,
  type TrackerAiPreWindowDays,
  type TrackerLineModel,
  type TrackerLinePayload,
  type TrackerSuggestionsResponse,
} from '@bt/shared/types';
import addTransactionsToBudget from '@controllers/budgets/add-transaction-to-budget';
import removeTransactionsFromBudget from '@controllers/budgets/remove-transaction-from-budget';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as getBudgetService from '@root/services/budget.service';
import * as createBudgetService from '@root/services/budgets/create-budget';
import type { getBudgetStats } from '@root/services/budgets/stats';
import { Response } from 'express';

import { downloadBinary } from './attachments';
import { makeRequest } from './common';
import { type SecondUserHandle, acceptShareInvitation, asUser, createShareInvitation } from './share';

interface TestCreateBudgetPayload extends EntityLogoWritePayload {
  id?: string;
  name: string;
  status?: string;
  type?: BUDGET_TYPES;
  categoryIds?: string[];
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  autoInclude?: boolean;
  limitAmount?: number | null;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface EditBudgetPayload extends EntityLogoWritePayload {
  name?: string;
  categoryIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: number | null;
  autoInclude?: boolean;
  archivePromptDismissed?: boolean;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface linkTransactionToBudgetPayload {
  transactionIds: string[];
}

export async function createCustomBudget<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: TestCreateBudgetPayload & { raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof createBudgetService.createBudget>>, R>({
    method: 'post',
    url: '/budgets',
    payload,
    raw,
  });
}

export async function getCustomBudgets<R extends boolean | undefined = undefined>({
  raw,
  status,
}: {
  raw?: R;
  status?: string;
} = {}) {
  return makeRequest<BudgetModel[], R>({
    method: 'get',
    url: '/budgets',
    payload: status ? { status } : null,
    raw,
  });
}

export async function getCustomBudgetById<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof getBudgetService.getBudgetById>>, R>({
    method: 'get',
    url: `/budgets/${id}`,
    raw,
  });
}

export async function deleteCustomBudget<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'delete',
    url: `/budgets/${id}`,
    raw,
  });
}

export async function editCustomBudget({
  id,
  params,
  raw,
}: {
  id: string;
  params: EditBudgetPayload;
  raw?: false;
}): Promise<Response>;
export async function editCustomBudget({
  id,
  params,
  raw,
}: {
  id: string;
  params: EditBudgetPayload;
  raw?: true;
}): Promise<BudgetModel>;
export async function editCustomBudget({
  id,
  params,
  raw = true,
}: {
  id: string;
  params: EditBudgetPayload;
  raw?: boolean;
}): Promise<Response | BudgetModel> {
  const result = await makeRequest({
    method: 'put',
    url: `/budgets/${id}`,
    payload: params,
    raw,
  });

  return result;
}

export async function addTransactionToCustomBudget<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: linkTransactionToBudgetPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof addTransactionsToBudget>> | null, R>({
    method: 'post',
    url: `/budgets/${id}/transactions`,
    payload,
    raw,
  });
}

export async function removeTransactionFromCustomBudget<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: linkTransactionToBudgetPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof removeTransactionsFromBudget>> | null, R>({
    method: 'delete',
    url: `/budgets/${id}/transactions`,
    payload,
    raw,
  });
}

export async function archiveCustomBudget<R extends boolean | undefined = undefined>({
  id,
  isArchived,
  raw,
}: {
  id: string;
  isArchived: boolean;
  raw?: R;
}) {
  return makeRequest<BudgetModel, R>({
    method: 'patch',
    url: `/budgets/${id}/archive`,
    payload: { isArchived },
    raw,
  });
}

export async function duplicateCustomBudget<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<BudgetModel, R>({
    method: 'post',
    url: `/budgets/${id}/duplicate`,
    raw,
  });
}

export async function createTrackerLine<R extends boolean | undefined = undefined>({
  budgetId,
  payload,
  raw,
}: {
  budgetId: string;
  payload: TrackerLinePayload;
  raw?: R;
}) {
  return makeRequest<TrackerLineModel, R>({
    method: 'post',
    url: `/budgets/${budgetId}/lines`,
    payload,
    raw,
  });
}

export async function updateTrackerLine<R extends boolean | undefined = undefined>({
  budgetId,
  lineId,
  payload,
  raw,
}: {
  budgetId: string;
  lineId: string;
  payload: Partial<TrackerLinePayload>;
  raw?: R;
}) {
  return makeRequest<TrackerLineModel, R>({
    method: 'put',
    url: `/budgets/${budgetId}/lines/${lineId}`,
    payload,
    raw,
  });
}

export async function deleteTrackerLine<R extends boolean | undefined = undefined>({
  budgetId,
  lineId,
  raw,
}: {
  budgetId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<Record<string, never>, R>({
    method: 'delete',
    url: `/budgets/${budgetId}/lines/${lineId}`,
    raw,
  });
}

export async function getStats<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof getBudgetStats>> | null, R>({
    method: 'get',
    url: `/budgets/${id}/stats`,
    raw,
  });
}

interface CategoryBudgetTransactionsResponse {
  transactions: Array<{
    id: string;
    time: Date;
    transactionType: string;
    refAmount: number;
    amount: number;
    note: string | null;
    categoryId: string | null;
    accountId: string;
    effectiveCategory?: {
      id: string;
      name: string;
      color: string;
    };
    effectiveRefAmount?: number;
  }>;
  total: number;
}

export async function getCategoryBudgetTransactions<R extends boolean | undefined = undefined>({
  id,
  from,
  limit,
  raw,
}: {
  id: string;
  from?: number;
  limit?: number;
  raw?: R;
}) {
  const queryParams = new URLSearchParams();
  if (from !== undefined) queryParams.set('from', String(from));
  if (limit !== undefined) queryParams.set('limit', String(limit));
  const queryString = queryParams.toString();

  return makeRequest<CategoryBudgetTransactionsResponse, R>({
    method: 'get',
    url: `/budgets/${id}/category-transactions${queryString ? `?${queryString}` : ''}`,
    raw,
  });
}

export async function getSpendingStats<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<BudgetSpendingStatsResponse, R>({
    method: 'get',
    url: `/budgets/${id}/spending-stats`,
    raw,
  });
}

export async function shareBudgetWith({
  budgetId,
  recipient,
  permission,
}: {
  budgetId: string;
  recipient: SecondUserHandle;
  permission: SharePermission;
}) {
  const invitation = await createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.budget,
    resourceId: budgetId,
    permission,
    raw: true,
  });
  await asUser({ cookies: recipient.cookies, fn: () => acceptShareInvitation({ token: invitation.token, raw: true }) });
}

export async function getLogoImage({ id }: { id: string }) {
  const { statusCode, body, header } = await downloadBinary({ url: `/logo-images/${id}` });
  return {
    statusCode,
    body,
    contentType: header({ name: 'content-type' }),
    cacheControl: header({ name: 'cache-control' }),
  };
}

export async function getTrackerSuggestions<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<TrackerSuggestionsResponse<TransactionApiResponse>, R>({
    method: 'get',
    url: `/budgets/${id}/suggestions`,
    raw,
  });
}

export async function resolveTrackerSuggestions<R extends boolean | undefined = undefined>({
  id,
  action,
  suggestionIds,
  raw,
}: {
  id: string;
  action: 'accept' | 'reject' | 'restore';
  suggestionIds: string[];
  raw?: R;
}) {
  return makeRequest<{ resolvedCount: number }, R>({
    method: 'post',
    url: `/budgets/${id}/suggestions/${action}`,
    payload: { suggestionIds },
    raw,
  });
}

/** The scan runs on a queue with no HTTP trigger, so tests poll the scan status until it is idle. */
export async function waitForTrackerScanToSettle({
  id,
  timeoutMs = 20000,
  pollIntervalMs = 200,
}: {
  id: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const { scan } = await getTrackerSuggestions({ id, raw: true });
    if (scan.status === 'idle') return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Tracker scan did not settle within ${timeoutMs}ms`);
}
