import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { captureException } from '@/lib/sentry';
import { useUserStore } from '@/stores';
import { type AI_FEATURE, FEATURE_TRIAL_DAYS, type Feature, getAiFeatureEntitlement } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

export const useAiFeatureAccess = ({ aiFeature }: { aiFeature: AI_FEATURE }) => {
  const userStore = useUserStore();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { addErrorNotification } = useNotificationCenter();

  const feature = getAiFeatureEntitlement({ feature: aiFeature });
  const trialDays = (FEATURE_TRIAL_DAYS as Partial<Record<Feature, number>>)[feature] ?? null;

  const isPlanGated = computed(() => userStore.isFeatureGated(feature));
  const hasTrialRecord = computed(() => Boolean(userStore.entitlements?.featureTrials[feature]));
  const trialDaysLeft = computed(() => userStore.featureTrialDaysLeft({ feature }));
  const isTrialAvailable = computed(
    () => trialDays !== null && isPlanGated.value && !hasTrialRecord.value && !userStore.isReadOnly,
  );

  const isStartingTrial = ref(false);
  /** Resolves to whether the trial started. */
  const startTrial = async (): Promise<boolean> => {
    if (isStartingTrial.value) return false;
    isStartingTrial.value = true;
    try {
      await userStore.startFeatureTrial({ feature });
      void queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });
      return true;
    } catch (error) {
      captureException({ error, context: { scope: 'ai-feature:start-trial', aiFeature } });
      addErrorNotification(t('billing.trialStartFailed'));
      return false;
    } finally {
      isStartingTrial.value = false;
    }
  };

  return { isPlanGated, hasTrialRecord, isTrialAvailable, trialDaysLeft, trialDays, startTrial, isStartingTrial };
};
