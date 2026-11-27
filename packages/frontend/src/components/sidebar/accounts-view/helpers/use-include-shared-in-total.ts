import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useAccountsStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

/** Whether the sidebar Bank Accounts total counts accounts shared with the user. On when unset. */
export const useIncludeSharedInTotal = () => {
  const { data: userSettings, patch, isPatching } = useUserSettings();
  const { activeAccounts } = storeToRefs(useAccountsStore());

  const includeSharedInTotal = computed(() => userSettings.value?.includeSharedAccountsInSidebarTotal !== false);

  // Grouped accounts come from the groups query, which carries no `share`, so callers match by id.
  const sharedWithMeIds = computed(
    () => new Set(activeAccounts.value.filter((a) => a.share && !a.share.isOwner).map((a) => a.id)),
  );

  const setIncludeSharedInTotal = (value: boolean) => patch({ includeSharedAccountsInSidebarTotal: value });

  return { includeSharedInTotal, sharedWithMeIds, setIncludeSharedInTotal, isUpdating: isPatching };
};
