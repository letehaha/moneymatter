import { api } from '@/api/_api';
import { AccountGroups } from '@/common/types/models';
import { EntityLogoPayload } from '@bt/shared/types';

export const loadAccountGroups = async (
  payload: { accountIds?: string[]; includeArchived?: boolean } = {},
): Promise<AccountGroups[]> => {
  return api.get('/account-group', payload);
};

export const createAccountsGroup = async (
  payload: { name: string; parentGroupId?: string | null } & EntityLogoPayload,
): Promise<void> => {
  await api.post('/account-group', payload);
};

export const linkAccountToGroup = async (payload: { accountId: string; groupId: string }) => {
  await api.post(`/account-group/${payload.groupId}/add-account/${payload.accountId}`);
};

export const removeAccountFromGroup = async (payload: { accountIds: string[]; groupId: string }) => {
  await api.delete(`/account-group/${payload.groupId}/accounts`, {
    data: { accountIds: payload.accountIds },
  });
};

export const updateAccountGroup = async (payload: {
  groupId: string;
  updates: { name?: string; parentGroupId?: string | null } & EntityLogoPayload;
}) => {
  await api.put(`/account-group/${payload.groupId}`, payload.updates);
};

export const deleteAccountGroup = async (payload: { groupId: string }) => {
  await api.delete(`/account-group/${payload.groupId}`);
};
