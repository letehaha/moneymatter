import { ROUTES_NAMES } from '@/routes/constants';
import { type MaybeRefOrGetter, computed, toValue, watch } from 'vue';
import { useRoute } from 'vue-router';

export function useCloseDialogWhen({ when, close }: { when: MaybeRefOrGetter<boolean>; close: () => void }) {
  watch(
    () => toValue(when),
    (shouldClose) => shouldClose && close(),
  );
}

/** For dialogs whose AI-usage links lead to the AI models or billing settings. */
export function useIsAiUsageExitPage() {
  const route = useRoute();
  return computed(
    () => route.name === ROUTES_NAMES.settingsPlanBilling || route.name === ROUTES_NAMES.settingsAiModels,
  );
}
