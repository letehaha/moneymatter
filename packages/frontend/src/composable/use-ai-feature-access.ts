import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage, isHandledByApiClient } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { useUserStore } from '@/stores';
import { type AI_FEATURE, FEATURE_TRIAL_DAYS, type Feature, getAiFeatureEntitlement } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

export const useFeatureTrialAccess = ({ feature }: { feature: Feature }) => {
  const userStore = useUserStore();
  const { t } = useI18n();
  const { addErrorNotification } = useNotificationCenter();

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
      return true;
    } catch (error) {
      if (!isHandledByApiClient({ error })) {
        captureException({ error, context: { scope: 'feature-trial:start', feature } });
        addErrorNotification(extractApiErrorMessage(error) || t('billing.trialStartFailed'));
      }
      return false;
    } finally {
      isStartingTrial.value = false;
    }
  };

  return { isPlanGated, hasTrialRecord, isTrialAvailable, trialDaysLeft, trialDays, startTrial, isStartingTrial };
};

export const useAiFeatureAccess = ({ aiFeature }: { aiFeature: AI_FEATURE }) => {
  const queryClient = useQueryClient();
  const access = useFeatureTrialAccess({ feature: getAiFeatureEntitlement({ feature: aiFeature }) });

  const startTrial = async (): Promise<boolean> => {
    const started = await access.startTrial();
    if (started) void queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });
    return started;
  };

  return { ...access, startTrial };
};
