import { api } from '@/api/_api';
import { BudgetModel, type BudgetSpendingStatsResponse } from '@bt/shared/types';

interface editBudgetParamsParams {
  name?: string;
  limitAmount?: number;
  categoryIds?: string[];
}

export const loadSystemBudgets = async ({ status }: { status?: string } = {}): Promise<BudgetModel[]> => {
  return api.get('/budgets', status ? { status } : undefined);
};

export const loadBudgetById = async (id: string): Promise<BudgetModel> => {
  return api.get(`/budgets/${id}`);
};

export const createBudget = async (payload: Omit<BudgetModel, 'id' | 'userId'>): Promise<BudgetModel> => {
  const params = {
    ...payload,
    limitAmount: payload.limitAmount && payload.limitAmount > 0 ? payload.limitAmount : null,
  };
  return api.post('/budgets', params);
};

export const deleteBudget = async (budgetId: string) => api.delete(`/budgets/${budgetId}`);

export const archiveBudget = async ({ budgetId, isArchived }: { budgetId: string; isArchived: boolean }) =>
  api.patch(`/budgets/${budgetId}/archive`, { isArchived });

export const editBudget = async ({ budgetId, payload }: { budgetId: string; payload: editBudgetParamsParams }) => {
  await api.put(`/budgets/${budgetId}`, payload);
};

export const addTransactionsToBudget = async (budgetId: string, params: Record<string, unknown>) =>
  api.post(`/budgets/${budgetId}/transactions`, params);

export const removeTransactionsFromBudget = async ({
  budgetId,
  payload,
}: {
  budgetId: string;
  payload: { transactionIds: string[] };
}) => api.delete(`/budgets/${budgetId}/transactions`, { data: payload });

export interface StatsResponse {
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number; // Net difference
    utilizationRate: null | number; // Percentage used (0-100)
    transactionsCount: number;
    firstTransactionDate: string | null; // ISO date string of earliest transaction
    lastTransactionDate: string | null; // ISO date string of latest transaction
  };
}

export const loadBudgetStats = async ({ budgetId }: { budgetId: string }): Promise<StatsResponse> => {
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
