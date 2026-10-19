import { api } from '@/api/_api';
import {
  type BUDGET_TYPES,
  BudgetModel,
  type BudgetSpendingStatsResponse,
  type BudgetStatsResponse,
  type EntityLogoWritePayload,
  type ResolveTrackerSuggestionsBody,
  type ResolveTrackerSuggestionsResponse,
  type TrackerAiPreWindowDays,
  type TrackerLineModel,
  type TrackerLinePayload,
  type TrackerSuggestionsResponse,
} from '@bt/shared/types';

interface SmartTrackingPayload {
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface EditBudgetPayload extends EntityLogoWritePayload, SmartTrackingPayload {
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

interface CreateBudgetPayload extends EntityLogoWritePayload, SmartTrackingPayload {
  name: string;
  type?: BUDGET_TYPES;
  categoryIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: number | null;
  autoInclude?: boolean;
}

export const createBudget = async (payload: CreateBudgetPayload): Promise<BudgetModel> => api.post('/budgets', payload);

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

interface CategoryBudgetTransaction {
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

export const loadTrackerSuggestions = async ({ budgetId }: { budgetId: string }): Promise<TrackerSuggestionsResponse> =>
  api.get(`/budgets/${budgetId}/suggestions`);

export const acceptTrackerSuggestions = async ({
  budgetId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { budgetId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/budgets/${budgetId}/suggestions/accept`, { suggestionIds });

export const rejectTrackerSuggestions = async ({
  budgetId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { budgetId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/budgets/${budgetId}/suggestions/reject`, { suggestionIds });

export const restoreTrackerSuggestions = async ({
  budgetId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { budgetId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/budgets/${budgetId}/suggestions/restore`, { suggestionIds });
