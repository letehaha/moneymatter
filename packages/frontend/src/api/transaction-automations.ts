import { api } from '@/api/_api';
import type {
  AutomationAction,
  AutomationApplyResult,
  AutomationConditions,
  AutomationPreviewResult,
  RecordId,
  TransactionAutomationModel,
} from '@bt/shared/types';

interface TransactionAutomationPayload {
  name: string;
  isEnabled?: boolean;
  conditions: AutomationConditions;
  actions: AutomationAction[];
}

export const loadTransactionAutomations = async (): Promise<TransactionAutomationModel[]> => api.get('/automations');

export const createTransactionAutomation = async ({
  payload,
}: {
  payload: TransactionAutomationPayload;
}): Promise<TransactionAutomationModel> => api.post('/automations', payload);

export const updateTransactionAutomation = async ({
  id,
  payload,
}: {
  id: RecordId;
  payload: Partial<TransactionAutomationPayload>;
}): Promise<TransactionAutomationModel> => api.patch(`/automations/${id}`, payload);

export const deleteTransactionAutomation = async ({ id }: { id: RecordId }): Promise<void> =>
  api.delete(`/automations/${id}`);

export const reorderTransactionAutomations = async ({
  ids,
}: {
  ids: RecordId[];
}): Promise<TransactionAutomationModel[]> => api.put('/automations/reorder', { ids });

export const previewTransactionAutomation = async ({
  conditions,
  automationId,
  limit,
}: {
  conditions?: AutomationConditions;
  automationId?: RecordId;
  limit?: number;
}): Promise<AutomationPreviewResult> => api.post('/automations/preview', { conditions, automationId, limit });

export const applyAutomationToHistory = async ({
  id,
  transactionIds,
}: {
  id: RecordId;
  transactionIds: RecordId[];
}): Promise<AutomationApplyResult> => api.post(`/automations/${id}/apply`, { transactionIds });
