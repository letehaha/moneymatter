import type { TransactionsView } from '@/api/user-settings';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { computed, ref } from 'vue';

const DEFAULT_MOBILE_VIEW: TransactionsView = 'list';
const DEFAULT_DESKTOP_VIEW: TransactionsView = 'table';

/**
 * Preferred transactions view, split per screen-size class so a user can keep
 * `list` on a phone but `table` on a desktop (or vice versa). Persisted in
 * UserSettings under `ui.transactionsTable.{mobileView,desktopView}`. A local
 * override shadows the stored value so toggling feels instant while the
 * settings mutation is in flight.
 */
export function useTransactionsView() {
  const { data: userSettings, patch: patchSettings } = useUserSettings();

  const localMobileView = ref<TransactionsView | null>(null);
  const localDesktopView = ref<TransactionsView | null>(null);
  const localAlwaysShowLockedCells = ref<boolean | null>(null);

  const mobileView = computed<TransactionsView>(
    () => localMobileView.value ?? userSettings.value?.ui?.transactionsTable?.mobileView ?? DEFAULT_MOBILE_VIEW,
  );

  const desktopView = computed<TransactionsView>(
    () => localDesktopView.value ?? userSettings.value?.ui?.transactionsTable?.desktopView ?? DEFAULT_DESKTOP_VIEW,
  );

  const setMobileView = (view: TransactionsView) => {
    localMobileView.value = view;
    patchSettings({ ui: { transactionsTable: { mobileView: view } } });
  };

  const setDesktopView = (view: TransactionsView) => {
    localDesktopView.value = view;
    patchSettings({ ui: { transactionsTable: { desktopView: view } } });
  };

  const alwaysShowLockedCells = computed(
    () => localAlwaysShowLockedCells.value ?? userSettings.value?.ui?.transactionsTable?.alwaysShowLockedCells ?? false,
  );

  const setAlwaysShowLockedCells = (value: boolean) => {
    localAlwaysShowLockedCells.value = value;
    patchSettings({ ui: { transactionsTable: { alwaysShowLockedCells: value } } });
  };

  return {
    mobileView,
    setMobileView,
    desktopView,
    setDesktopView,
    alwaysShowLockedCells,
    setAlwaysShowLockedCells,
  };
}
