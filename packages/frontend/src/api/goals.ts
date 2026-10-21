import { api } from '@/api/_api';
import type { CreateGoalPayload, GoalModel, RecordId, UpdateGoalPayload } from '@bt/shared/types';

export const loadGoals = (): Promise<GoalModel[]> => api.get('/goals');

export const loadGoal = ({ goalId }: { goalId: RecordId }): Promise<GoalModel> => api.get(`/goals/${goalId}`);

export const createGoal = ({ payload }: { payload: CreateGoalPayload }): Promise<GoalModel> =>
  api.post('/goals', payload);

export const updateGoal = ({ goalId, payload }: { goalId: RecordId; payload: UpdateGoalPayload }): Promise<GoalModel> =>
  api.patch(`/goals/${goalId}`, payload);

export const deleteGoal = ({ goalId }: { goalId: RecordId }): Promise<void> => api.delete(`/goals/${goalId}`);
