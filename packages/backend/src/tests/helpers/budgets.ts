import { BUDGET_TYPES, BudgetModel, endpointsTypes } from '@bt/shared/types';
import addTransactionsToBudget from '@controllers/budgets/add-transaction-to-budget';
import removeTransactionsFromBudget from '@controllers/budgets/remove-transaction-from-budget';
import * as getBudgetService from '@root/services/budget.service';
import * as createBudgetService from '@root/services/budgets/create-budget';
import type { getBudgetStats } from '@root/services/budgets/stats';
import { Response } from 'express';

import { makeRequest } from './common';

interface TestCreateBudgetPayload {
  id?: string;
  name: string;
  status?: string;
  type?: BUDGET_TYPES;
  categoryIds?: string[];
  tagIds?: string[];
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  autoInclude?: boolean;
  limitAmount?: number | null;
}

interface EditBudgetPayload {
  name?: string;
  categoryIds?: string[];
  tagIds?: string[];
  startDate?: string;
  endDate?: string;
  limitAmount?: number;
  autoInclude?: boolean;
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
  return makeRequest<Awaited<ReturnType<typeof addTransactionsToBudget.handler>> | null, R>({
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
  return makeRequest<Awaited<ReturnType<typeof removeTransactionsFromBudget.handler>> | null, R>({
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
  return makeRequest<endpointsTypes.BudgetSpendingStatsResponse, R>({
    method: 'get',
    url: `/budgets/${id}/spending-stats`,
    raw,
  });
}
