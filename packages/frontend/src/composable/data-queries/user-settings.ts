import { type UserSettingsSchema, getUserSettings, patchUserSettings, updateUserSettings } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useNotificationCenter } from '@/components/notification-center';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export const userSettingsQueryOptions = {
  queryKey: VUE_QUERY_CACHE_KEYS.userSettings,
  queryFn: getUserSettings,
  staleTime: Infinity,
};

export const useUserSettings = (
  queryOptions: Partial<Parameters<typeof useQuery<UserSettingsSchema, Error>>[0]> = {},
) => {
  const queryArray = [...VUE_QUERY_CACHE_KEYS.userSettings];
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { addErrorNotification } = useNotificationCenter();
  const query = useQuery({
    ...userSettingsQueryOptions,
    queryKey: queryArray,
    ...queryOptions,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryArray });
  };

  // The full update sends the whole settings object, so `isUpdating` is shared
  // across every caller: two in flight at once would overwrite each other.
  const updateMutationKey = [...queryArray, 'update'];
  const updatesInFlight = useIsMutating({ mutationKey: updateMutationKey });
  const mutation = useMutation({
    mutationKey: updateMutationKey,
    mutationFn: updateUserSettings,
    onSuccess: (data) => queryClient.setQueryData(queryArray, () => data),
    onError: invalidate,
  });

  // Partial update: the server merges the patch into its stored value, so
  // callers don't need the settings loaded and concurrent slice updates can't
  // overwrite each other. The response is the full merged settings.
  const patchMutation = useMutation({
    mutationFn: patchUserSettings,
    onSuccess: (data) => queryClient.setQueryData(queryArray, () => data),
    onError: () => {
      addErrorNotification(t('common.errors.settingsSaveFailed'));
      invalidate();
    },
  });

  return {
    invalidate,
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isUpdating: computed(() => updatesInFlight.value > 0),
    patch: patchMutation.mutate,
    patchAsync: patchMutation.mutateAsync,
    isPatching: patchMutation.isPending,
    ...query,
  };
};
