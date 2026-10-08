import { api } from '@/api/_api';
import type { TransactionModel } from '@bt/shared/types';

export interface TransactionGroupResponse {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  transactionCount?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  transactions?: TransactionModel[];
}

export const loadTransactionGroups = async ({
  includeTransactions,
}: {
  includeTransactions?: boolean;
} = {}): Promise<TransactionGroupResponse[]> => {
  return api.get('/transaction-groups', {
    ...(includeTransactions !== undefined && { includeTransactions }),
  });
};

export const loadTransactionGroupById = async ({ id }: { id: string }): Promise<TransactionGroupResponse> => {
  return api.get(`/transaction-groups/${id}`);
};

export const createTransactionGroup = async ({
  name,
  note,
  transactionIds,
}: {
  name: string;
  note?: string | null;
  transactionIds: string[];
}): Promise<TransactionGroupResponse> => {
  return api.post('/transaction-groups', { name, note, transactionIds });
};

export const updateTransactionGroup = async ({
  id,
  payload,
}: {
  id: string;
  payload: { name?: string; note?: string | null };
}): Promise<TransactionGroupResponse> => {
  return api.put(`/transaction-groups/${id}`, payload);
};

export const deleteTransactionGroup = async ({ id }: { id: string }): Promise<void> => {
  return api.delete(`/transaction-groups/${id}`);
};

export const addTransactionsToGroup = async ({
  groupId,
  transactionIds,
}: {
  groupId: string;
  transactionIds: string[];
}): Promise<TransactionGroupResponse> => {
  return api.post(`/transaction-groups/${groupId}/transactions`, { transactionIds });
};

export const removeTransactionsFromGroup = async ({
  groupId,
  transactionIds,
  force,
}: {
  groupId: string;
  transactionIds: string[];
  force?: boolean;
}): Promise<{ group: TransactionGroupResponse | null; dissolved: boolean }> => {
  return api.delete(`/transaction-groups/${groupId}/transactions`, {
    data: { transactionIds, ...(force !== undefined && { force }) },
  });
};
