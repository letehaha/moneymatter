import { type UserSettingsSchema } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { PUSH_GROUP_DEFAULTS, type PushGroup } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';

/**
 * Read and write access to the Web Push group switches. A switch flips in the cached settings
 * first and is saved as a patch of that one group; when the save fails `useUserSettings` shows
 * the error and refetches, which puts the switch back.
 */
export const usePushGroups = () => {
  const queryClient = useQueryClient();
  const { data: userSettings, patchAsync, isLoading } = useUserSettings();

  const isGroupEnabled = ({ group }: { group: PushGroup }): boolean =>
    userSettings.value?.notifications?.push?.groups?.[group] ?? PUSH_GROUP_DEFAULTS[group];

  const toggleGroup = async ({ group, value }: { group: PushGroup; value: boolean }): Promise<void> => {
    const queryKey = [...VUE_QUERY_CACHE_KEYS.userSettings];

    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<UserSettingsSchema>(queryKey, (old) =>
      old
        ? {
            ...old,
            notifications: {
              ...old.notifications,
              push: { ...old.notifications?.push, groups: { ...old.notifications?.push?.groups, [group]: value } },
            },
          }
        : old,
    );

    try {
      await patchAsync({ notifications: { push: { groups: { [group]: value } } } });
    } catch {
      // Already reported and rolled back by `useUserSettings`.
    }
  };

  return { isGroupEnabled, toggleGroup, isLoading };
};
