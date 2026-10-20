import {
  createAccountsGroup,
  deleteAccountGroup,
  linkAccountToGroup,
  loadAccountGroups,
  removeAccountFromGroup,
  updateAccountGroup,
} from '@/api/account-groups';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';
import { listAccountGroupPaths } from '@/components/sidebar/accounts-view/helpers/list-account-group-paths';
import { type EntityLogoPayload } from '@bt/shared/types';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { MaybeRefOrGetter, Ref, computed, toValue } from 'vue';

import { useInvalidatingMutation } from './use-invalidating-mutation';

const selectTree = (groups: AccountGroups[]) => buildAccountGroupTree({ groups });

export const useAccountGroupsQuery = ({ placeholderData }: { placeholderData?: AccountGroups[] } = {}) =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.accountGroups,
    queryFn: () => loadAccountGroups(),
    staleTime: Infinity,
    placeholderData,
    select: selectTree,
  });

/** Groups as a depth-first pick list, each labelled with its full path (`Banks / Indonesia`). */
export const useAccountGroupPaths = () => {
  const query = useAccountGroupsQuery();
  const entries = computed(() => listAccountGroupPaths({ groups: query.data.value ?? [] }));
  const pathById = computed(() => new Map(entries.value.map((entry) => [entry.group.id, entry.path])));

  return { ...query, entries, pathById };
};

export const useAccountGroupForAccount = (
  accountId: Ref<string>,
  queryOptions: { enabled?: MaybeRefOrGetter<boolean> } = {},
) => {
  const queryClient = useQueryClient();
  const query = useQuery<AccountGroups | null>({
    queryFn: async (): Promise<AccountGroups | null> => {
      const result = await loadAccountGroups({
        accountIds: [accountId.value],
        includeArchived: true,
      });
      return result.length ? result[0]! : null;
    },
    queryKey: [...VUE_QUERY_CACHE_KEYS.accountGroupForAccount, accountId],
    staleTime: Infinity,
    ...queryOptions,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: [...VUE_QUERY_CACHE_KEYS.accountGroupForAccount, accountId.value],
    });
  };
  return {
    ...query,
    group: query.data,
    invalidate,
  };
};

/**
 * Shared wiring for every write against `/account-group`: refresh both caches that hold
 * group membership — the flat list and the per-account lookup — then report the outcome.
 *
 * Notification keys live in the `common` i18n chunk, not `settings/accounts-groups`: these
 * writes also fire from the link dialog on the accounts and account pages, where the
 * settings chunk was never loaded and a key from it would render as a raw dotted path.
 */
const useAccountGroupMutation = <TVariables = void>({
  mutationFn,
  successKey,
  errorKey,
  onSuccess,
}: {
  mutationFn: (variables: TVariables) => Promise<unknown>;
  /** Omit for writes whose result is obvious from the UI updating (e.g. creating a group). */
  successKey?: string;
  errorKey: string;
  onSuccess?: () => void;
}) =>
  useInvalidatingMutation<unknown, TVariables>({
    mutationFn,
    invalidateKeys: [],
    // Refreshed on failure too: a multi-account link can fail midway with earlier moves applied.
    // The per-account key is a prefix, so it drops the cached group for every account.
    invalidateOnSettleKeys: [VUE_QUERY_CACHE_KEYS.accountGroups, VUE_QUERY_CACHE_KEYS.accountGroupForAccount],
    successKey,
    errorKey,
    onSuccess,
  });

export const useCreateAccountGroup = ({ onSuccess }: { onSuccess?: () => void } = {}) =>
  useAccountGroupMutation({
    mutationFn: (payload: { name: string; parentGroupId?: string | null } & EntityLogoPayload) =>
      createAccountsGroup(payload),
    errorKey: 'accountGroups.create.error',
    onSuccess,
  });

export const useUpdateAccountGroup = ({
  groupId,
  onSuccess,
}: {
  groupId: MaybeRefOrGetter<string>;
  onSuccess?: () => void;
}) =>
  useAccountGroupMutation({
    mutationFn: (updates: { name?: string; parentGroupId?: string | null } & EntityLogoPayload) =>
      updateAccountGroup({ groupId: toValue(groupId), updates }),
    successKey: 'accountGroups.update.success',
    errorKey: 'accountGroups.update.error',
    onSuccess,
  });

export const useDeleteAccountGroup = ({
  groupId,
  onSuccess,
}: {
  groupId: MaybeRefOrGetter<string>;
  onSuccess?: () => void;
}) =>
  useAccountGroupMutation({
    mutationFn: () => deleteAccountGroup({ groupId: toValue(groupId) }),
    successKey: 'accountGroups.delete.success',
    errorKey: 'accountGroups.delete.error',
    onSuccess,
  });

export const useLinkAccountToGroup = ({ onSuccess }: { onSuccess?: () => void } = {}) =>
  useAccountGroupMutation({
    mutationFn: ({ accountId, groupId }: { accountId: string; groupId: string }) =>
      linkAccountToGroup({ accountId, groupId }),
    successKey: 'accountGroups.link.success',
    errorKey: 'accountGroups.link.error',
    onSuccess,
  });

export const useLinkAccountsToGroup = ({ onSuccess }: { onSuccess?: () => void } = {}) =>
  useAccountGroupMutation({
    mutationFn: async ({ accountIds, groupId }: { accountIds: string[]; groupId: string }) => {
      for (const accountId of accountIds) {
        await linkAccountToGroup({ accountId, groupId });
      }
    },
    successKey: 'accountGroups.linkMany.success',
    errorKey: 'accountGroups.linkMany.error',
    onSuccess,
  });

export const useUnlinkAccountFromGroup = ({ onSuccess }: { onSuccess?: () => void } = {}) =>
  useAccountGroupMutation({
    mutationFn: ({ accountId, groupId }: { accountId: string; groupId: string }) =>
      removeAccountFromGroup({ accountIds: [accountId], groupId }),
    successKey: 'accountGroups.unlink.success',
    errorKey: 'accountGroups.unlink.error',
    onSuccess,
  });
