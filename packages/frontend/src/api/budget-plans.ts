import { api } from '@/api/_api';
import type {
  BudgetPlanCarryPolicy,
  BudgetPlanDetails,
  BudgetPlanLineEntry,
  BudgetPlanModel,
  BudgetPlanPeriod,
  BudgetPlanPeriodView,
  CreateBudgetPlanPayload,
  SetBudgetPlanAssignmentPayload,
} from '@bt/shared/types';

export const loadBudgetPlans = async (): Promise<BudgetPlanModel[]> =>
  api.get('/budget-plans', { includeDeleted: 'true' });

export const loadBudgetPlan = async ({ planId }: { planId: string }): Promise<BudgetPlanDetails> =>
  api.get(`/budget-plans/${planId}`);

export const createBudgetPlan = async ({ payload }: { payload: CreateBudgetPlanPayload }): Promise<BudgetPlanDetails> =>
  api.post('/budget-plans', payload);

export const restoreBudgetPlan = async ({ planId }: { planId: string }): Promise<BudgetPlanDetails> =>
  api.post(`/budget-plans/${planId}/restore`);

export const loadBudgetPlanPeriods = async ({ planId }: { planId: string }): Promise<BudgetPlanPeriod[]> =>
  api.get(`/budget-plans/${planId}/periods`);

export const loadBudgetPlanPeriodView = async ({
  planId,
  periodId,
}: {
  planId: string;
  periodId: string;
}): Promise<BudgetPlanPeriodView> => api.get(`/budget-plans/${planId}/periods/${periodId}`);

export const createBudgetPlanLine = async ({
  planId,
  payload,
}: {
  planId: string;
  payload: { name: string; categoryIds: string[]; activeFrom?: string };
}): Promise<BudgetPlanLineEntry> => api.post(`/budget-plans/${planId}/lines`, payload);

export const updateBudgetPlanLine = async ({
  planId,
  lineId,
  payload,
}: {
  planId: string;
  lineId: string;
  payload: { name?: string; categoryIds?: string[] };
}): Promise<BudgetPlanLineEntry> => api.patch(`/budget-plans/${planId}/lines/${lineId}`, payload);

export const archiveBudgetPlanLine = async ({ planId, lineId }: { planId: string; lineId: string }) =>
  api.post(`/budget-plans/${planId}/lines/${lineId}/archive`);

export const deleteBudgetPlanLine = async ({ planId, lineId }: { planId: string; lineId: string }) =>
  api.delete(`/budget-plans/${planId}/lines/${lineId}`);

export const restoreBudgetPlanLine = async ({
  planId,
  lineId,
}: {
  planId: string;
  lineId: string;
}): Promise<BudgetPlanLineEntry> => api.post(`/budget-plans/${planId}/lines/${lineId}/restore`);

export const setBudgetPlanAssignment = async ({
  planId,
  periodId,
  lineId,
  payload,
}: {
  planId: string;
  periodId: string;
  lineId: string;
  payload: SetBudgetPlanAssignmentPayload;
}): Promise<BudgetPlanPeriodView> =>
  api.put(`/budget-plans/${planId}/periods/${periodId}/lines/${lineId}/assignment`, payload);

export const updateBudgetPlan = async ({
  planId,
  payload,
}: {
  planId: string;
  payload: { name?: string; autoAttachAccounts?: boolean; carryPolicy?: BudgetPlanCarryPolicy };
}): Promise<BudgetPlanDetails> => api.patch(`/budget-plans/${planId}`, payload);

export const setBudgetPlanAccounts = async ({
  planId,
  accountIds,
}: {
  planId: string;
  accountIds: string[];
}): Promise<BudgetPlanDetails> => api.put(`/budget-plans/${planId}/accounts`, { accountIds });

export const deleteBudgetPlan = async ({ planId }: { planId: string }) => api.delete(`/budget-plans/${planId}`);
