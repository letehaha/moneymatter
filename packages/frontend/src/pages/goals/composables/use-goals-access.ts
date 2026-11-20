import { useFeatureTrialAccess } from '@/composable/use-ai-feature-access';
import { useUserStore } from '@/stores';
import { FEATURES } from '@bt/shared/types';
import { computed } from 'vue';

/** Reads stay open to everyone; writes need the plan or a running day trial. */
export const useGoalsAccess = () => {
  const userStore = useUserStore();
  const access = useFeatureTrialAccess({ feature: FEATURES.goals });
  const canWrite = computed(() => !access.isPlanGated.value && !userStore.isReadOnly);

  return { ...access, canWrite };
};
