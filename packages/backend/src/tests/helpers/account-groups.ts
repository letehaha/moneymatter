import * as accountGroupService from '@root/services/account-groups';

import { makeRequest } from './common';

export async function createAccountGroup<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: Omit<Parameters<typeof accountGroupService.createAccountGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.createAccountGroup>>, R>({
    method: 'post',
    url: '/account-group',
    payload,
    raw,
  });
}

export async function updateAccountGroup<R extends boolean | undefined = undefined>({
  raw,
  groupId,
  ...payload
}: Omit<Parameters<typeof accountGroupService.updateAccountGroup>[0], 'userId'> & {
  raw?: R;
}) {
  // The endpoint wraps the updated group in a single-element list.
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.updateAccountGroup>>[], R>({
    method: 'put',
    url: `/account-group/${groupId}`,
    payload,
    raw,
  });
}

export async function getAccountGroups<R extends boolean | undefined = undefined>({
  raw,
  includeArchived,
}: {
  raw?: R;
  includeArchived?: boolean;
} = {}) {
  const query: Record<string, string> = {};
  if (includeArchived !== undefined) query.includeArchived = String(includeArchived);

  return makeRequest<Awaited<ReturnType<typeof accountGroupService.getAccountGroups>>, R>({
    method: 'get',
    url: '/account-group',
    payload: Object.keys(query).length ? query : undefined,
    raw,
  });
}

export async function deleteAccountGroup<R extends boolean | undefined = undefined>({
  groupId,
  raw,
}: Omit<Parameters<typeof accountGroupService.deleteAccountGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.deleteAccountGroup>>, R>({
    method: 'delete',
    url: `/account-group/${groupId}`,
    raw,
  });
}

export async function moveAccountGroup<R extends boolean | undefined = undefined>({
  groupId,
  newParentGroupId,
  raw,
}: Omit<Parameters<typeof accountGroupService.moveAccountGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.moveAccountGroup>>[1][number], R>({
    method: 'put',
    url: `/account-group/${groupId}/move`,
    payload: { newParentGroupId },
    raw,
  });
}

export async function removeAccountFromGroup<R extends boolean | undefined = undefined>({
  groupId,
  accountIds,
  raw,
}: Omit<Parameters<typeof accountGroupService.removeAccountFromGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.removeAccountFromGroup>>, R>({
    method: 'delete',
    url: `/account-group/${groupId}/accounts`,
    payload: { accountIds },
    raw,
  });
}

export async function getAccountsInGroup<R extends boolean | undefined = undefined>({
  groupId,
  raw,
}: Omit<Parameters<typeof accountGroupService.getAccountsInGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.getAccountsInGroup>>, R>({
    method: 'get',
    url: `/account-group/${groupId}/accounts`,
    raw,
  });
}

export async function addAccountToGroup<R extends boolean | undefined = undefined>({
  raw,
  accountId,
  groupId,
}: Omit<Parameters<typeof accountGroupService.addAccountToGroup>[0], 'userId'> & {
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof accountGroupService.addAccountToGroup>>, R>({
    method: 'post',
    url: `/account-group/${groupId}/add-account/${accountId}`,
    raw,
  });
}
