import { api } from '@/api/_api';
import type {
  AddSuggestedBudgetLinesResponse,
  BudgetLineGoal,
  BudgetPlanCarryPolicy,
  BudgetPlanDetails,
  BudgetPlanLineEntry,
  BudgetPlanLineGroup,
  BudgetPlanModel,
  BudgetPlanPeriod,
  BudgetPlanPeriodView,
  BudgetPlanScheduled,
  BudgetSuggestionAnswers,
  BudgetSuggestionContext,
  BudgetPlanTrends,
  CreateBudgetPlanPayload,
  CreateBudgetPlanResponse,
  SetBudgetLineGoalPayload,
  SetBudgetPlanAssignmentPayload,
  SetBudgetPlanLayoutPayload,
} from '@bt/shared/types';

export const loadBudgetPlans = async (): Promise<BudgetPlanModel[]> =>
  api.get('/budget-plans', { includeDeleted: 'true' });

export const loadBudgetPlan = async ({ planId }: { planId: string }): Promise<BudgetPlanDetails> =>
  api.get(`/budget-plans/${planId}`);

export const createBudgetPlan = async ({
  payload,
}: {
  payload: CreateBudgetPlanPayload;
}): Promise<CreateBudgetPlanResponse> => api.post('/budget-plans', payload);

export const restoreBudgetPlan = async ({
  planId,
  replace,
}: {
  planId: string;
  replace?: boolean;
}): Promise<BudgetPlanDetails> => api.post(`/budget-plans/${planId}/restore`, replace ? { replace: true } : undefined);

export const loadBudgetPlanPeriods = async ({ planId }: { planId: string }): Promise<BudgetPlanPeriod[]> =>
  api.get(`/budget-plans/${planId}/periods`);

export const loadBudgetPlanPeriodView = async ({
  planId,
  periodId,
}: {
  planId: string;
  periodId: string;
}): Promise<BudgetPlanPeriodView> => api.get(`/budget-plans/${planId}/periods/${periodId}`);

export const loadBudgetPlanTrends = async ({
  planId,
  until,
  count,
}: {
  planId: string;
  until: string;
  count: number;
}): Promise<BudgetPlanTrends> => api.get(`/budget-plans/${planId}/trends`, { until, count });

export const loadBudgetPlanScheduled = async ({
  planId,
  periodId,
}: {
  planId: string;
  periodId: string;
}): Promise<BudgetPlanScheduled> => api.get(`/budget-plans/${planId}/periods/${periodId}/scheduled`);

export const createBudgetPlanLine = async ({
  planId,
  payload,
}: {
  planId: string;
  payload: { name: string; categoryIds: string[]; activeFrom?: string; groupId?: string | null };
}): Promise<BudgetPlanLineEntry> => api.post(`/budget-plans/${planId}/lines`, payload);

export const addSuggestedBudgetLines = async ({
  planId,
  answers,
}: {
  planId: string;
  answers?: BudgetSuggestionAnswers;
}): Promise<AddSuggestedBudgetLinesResponse> => api.post(`/budget-plans/${planId}/suggested-lines`, answers);

export const loadBudgetSuggestionContext = async ({
  accountIds,
}: {
  accountIds: string[];
}): Promise<BudgetSuggestionContext> =>
  api.get('/budget-plans/suggestion-context', { accountIds: accountIds.join(',') });

export const updateBudgetPlanLine = async ({
  planId,
  lineId,
  payload,
}: {
  planId: string;
  lineId: string;
  payload: { name?: string; categoryIds?: string[]; groupId?: string | null };
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
  payload: {
    name?: string;
    autoAttachAccounts?: boolean;
    carryPolicy?: BudgetPlanCarryPolicy;
    poolEnabled?: boolean;
    zeroSum?: boolean;
    expectedIncome?: number | null;
  };
}): Promise<BudgetPlanDetails> => api.patch(`/budget-plans/${planId}`, payload);

export const setBudgetPlanAccounts = async ({
  planId,
  accountIds,
}: {
  planId: string;
  accountIds: string[];
}): Promise<BudgetPlanDetails> => api.put(`/budget-plans/${planId}/accounts`, { accountIds });

export const deleteBudgetPlan = async ({ planId }: { planId: string }) => api.delete(`/budget-plans/${planId}`);

export const purgeBudgetPlan = async ({ planId }: { planId: string }) =>
  api.delete(`/budget-plans/${planId}`, { query: { permanent: 'true' } });

export const setBudgetLineGoal = async ({
  planId,
  lineId,
  payload,
}: {
  planId: string;
  lineId: string;
  payload: SetBudgetLineGoalPayload;
}): Promise<BudgetLineGoal> => api.put(`/budget-plans/${planId}/lines/${lineId}/goal`, payload);

export const deleteBudgetLineGoal = async ({ planId, lineId }: { planId: string; lineId: string }) =>
  api.delete(`/budget-plans/${planId}/lines/${lineId}/goal`);

/** Snoozing the already-snoozed period wakes the goal up again. */
export const toggleBudgetLineGoalSnooze = async ({
  planId,
  lineId,
  periodId,
}: {
  planId: string;
  lineId: string;
  periodId: string;
}): Promise<BudgetLineGoal> => api.post(`/budget-plans/${planId}/lines/${lineId}/goal/snooze`, { periodId });

export const createBudgetLineGroup = async ({
  planId,
  name,
}: {
  planId: string;
  name: string;
}): Promise<BudgetPlanLineGroup> => api.post(`/budget-plans/${planId}/groups`, { name });

export const updateBudgetLineGroup = async ({
  planId,
  groupId,
  name,
}: {
  planId: string;
  groupId: string;
  name: string;
}): Promise<BudgetPlanLineGroup> => api.patch(`/budget-plans/${planId}/groups/${groupId}`, { name });

export const deleteBudgetLineGroup = async ({ planId, groupId }: { planId: string; groupId: string }) =>
  api.delete(`/budget-plans/${planId}/groups/${groupId}`);

export const setBudgetPlanLayout = async ({
  planId,
  payload,
}: {
  planId: string;
  payload: SetBudgetPlanLayoutPayload;
}) => api.put(`/budget-plans/${planId}/layout`, payload);
