import { api } from '@/api/_api';
import {
  BudgetModel,
  type BudgetSpendingStatsResponse,
  type BudgetStatsResponse,
  type TrackerLineModel,
  type TrackerLinePayload,
} from '@bt/shared/types';

export interface EditBudgetPayload {
  name?: string;
  limitAmount?: number | null;
  categoryIds?: string[];
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  archivePromptDismissed?: boolean;
}

export const loadSystemBudgets = async ({ status }: { status?: string } = {}): Promise<BudgetModel[]> => {
  return api.get('/budgets', status ? { status } : undefined);
};

export const loadBudgetById = async (id: string): Promise<BudgetModel> => {
  return api.get(`/budgets/${id}`);
};

export const createBudget = async (
  payload: Omit<BudgetModel, 'id' | 'userId' | 'lines' | 'archivePromptDismissed'>,
): Promise<BudgetModel> => {
  const params = {
    ...payload,
    limitAmount: payload.limitAmount && payload.limitAmount > 0 ? payload.limitAmount : null,
  };
  return api.post('/budgets', params);
};

export const deleteBudget = async (budgetId: string) => api.delete(`/budgets/${budgetId}`);

export const archiveBudget = async ({ budgetId, isArchived }: { budgetId: string; isArchived: boolean }) =>
  api.patch(`/budgets/${budgetId}/archive`, { isArchived });

export const editBudget = async ({ budgetId, payload }: { budgetId: string; payload: EditBudgetPayload }) => {
  await api.put(`/budgets/${budgetId}`, payload);
};

export const duplicateBudget = async ({ budgetId }: { budgetId: string }): Promise<BudgetModel> =>
  api.post(`/budgets/${budgetId}/duplicate`);

export const addTransactionsToBudget = async (budgetId: string, params: Record<string, unknown>) =>
  api.post(`/budgets/${budgetId}/transactions`, params);

export const removeTransactionsFromBudget = async ({
  budgetId,
  payload,
}: {
  budgetId: string;
  payload: { transactionIds: string[] };
}) => api.delete(`/budgets/${budgetId}/transactions`, { data: payload });

export const createTrackerLine = async ({
  budgetId,
  payload,
}: {
  budgetId: string;
  payload: TrackerLinePayload;
}): Promise<TrackerLineModel> => api.post(`/budgets/${budgetId}/lines`, payload);

export const updateTrackerLine = async ({
  budgetId,
  lineId,
  payload,
}: {
  budgetId: string;
  lineId: string;
  payload: Partial<TrackerLinePayload>;
}): Promise<TrackerLineModel> => api.put(`/budgets/${budgetId}/lines/${lineId}`, payload);

export const deleteTrackerLine = async ({ budgetId, lineId }: { budgetId: string; lineId: string }) =>
  api.delete(`/budgets/${budgetId}/lines/${lineId}`);

export const loadBudgetStats = async ({ budgetId }: { budgetId: string }): Promise<BudgetStatsResponse> => {
  return api.get(`/budgets/${budgetId}/stats`);
};

export interface CategoryBudgetTransaction {
  id: string;
  time: string;
  transactionType: 'income' | 'expense';
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
}

interface CategoryBudgetTransactionsResponse {
  transactions: CategoryBudgetTransaction[];
  total: number;
}

export const loadCategoryBudgetTransactions = async ({
  budgetId,
  from = 0,
  limit = 50,
}: {
  budgetId: string;
  from?: number;
  limit?: number;
}): Promise<CategoryBudgetTransactionsResponse> => {
  return api.get(`/budgets/${budgetId}/category-transactions`, { from, limit });
};

export const loadBudgetSpendingStats = async ({
  budgetId,
}: {
  budgetId: string;
}): Promise<BudgetSpendingStatsResponse> => {
  return api.get(`/budgets/${budgetId}/spending-stats`);
};
