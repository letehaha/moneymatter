import { api } from '@/api/_api';
import type {
  TransactionTemplateModel,
  CreateTransactionTemplateBody,
  UpdateTransactionTemplateBody,
} from '@bt/shared/types';

export const loadTransactionTemplates = async (): Promise<TransactionTemplateModel[]> => {
  return api.get('/transaction-templates');
};

export const createTransactionTemplate = async ({
  payload,
}: {
  payload: CreateTransactionTemplateBody;
}): Promise<TransactionTemplateModel> => {
  return api.post('/transaction-templates', payload);
};

export const updateTransactionTemplate = async ({
  id,
  payload,
}: {
  id: string;
  payload: UpdateTransactionTemplateBody;
}): Promise<TransactionTemplateModel> => {
  return api.put(`/transaction-templates/${id}`, payload);
};

export const deleteTransactionTemplate = async ({ id }: { id: string }): Promise<{ success: true }> => {
  return api.delete(`/transaction-templates/${id}`);
};
