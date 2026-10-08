import { api } from '@/api/_api';
import {
  ACCOUNT_CATEGORIES,
  AccountModel,
  AccountWithRelinkStatus,
  type LinkResidualTarget,
  TransactionModel,
  type CreateAccountBody,
  type UpdateAccountBody,
} from '@bt/shared/types';

export const loadAccounts = async (): Promise<AccountWithRelinkStatus[]> => {
  return api.get('/accounts');
};

export const createAccount = async (payload: CreateAccountBody): Promise<AccountModel> => {
  return api.post('/accounts', {
    ...payload,
    accountCategory: payload.accountCategory || ACCOUNT_CATEGORIES.general,
  });
};

export const editAccount = async ({
  id,
  ...data
}: UpdateAccountBody & {
  id: string;
}): Promise<AccountModel> => {
  return api.put(`/accounts/${id}`, data);
};

export const getAccountTransactionCount = async ({ id }: { id: string }): Promise<{ transactionCount: number }> => {
  return api.get(`/accounts/${id}/transaction-count`);
};

export interface DeleteAccountPayload {
  id: string;
  removePortfolioTransfers?: boolean;
}
export const deleteAccount = async ({ id, removePortfolioTransfers }: DeleteAccountPayload): Promise<void> =>
  api.delete(`/accounts/${id}`, { query: { removePortfolioTransfers } });

export interface UnlinkAccountFromBankConnectionPayload {
  id: string;
}
export const balanceAdjustment = async ({
  id,
  targetBalance,
  note,
  time,
}: {
  id: string;
  targetBalance: number;
  note?: string;
  time?: Date;
}): Promise<{
  transaction: TransactionModel | null;
  previousBalance: number;
  newBalance: number;
}> => api.post(`/accounts/${id}/balance-adjustment`, { targetBalance, note, time });

export const unlinkAccountFromBankConnection = async ({
  id,
}: UnlinkAccountFromBankConnectionPayload): Promise<AccountModel> => {
  return api.post(`/accounts/${id}/unlink`);
};

interface LinkAccountToBankConnectionPayload {
  accountId: string;
  connectionId: string;
  externalAccountId: string;
  residualTarget?: LinkResidualTarget;
}
export const linkAccountToBankConnection = async ({
  accountId,
  connectionId,
  externalAccountId,
  residualTarget,
}: LinkAccountToBankConnectionPayload): Promise<{
  account: AccountModel;
  balanceDifference: number;
  message: string;
}> => {
  return api.post(`/accounts/${accountId}/link`, {
    connectionId,
    externalAccountId,
    residualTarget,
  });
};
