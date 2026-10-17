import {
  type CustomInstructionsResponse,
  getAiFeaturesStatus,
  getCustomInstructions,
  resetAiFeatureConfig,
  setAiFeatureConfig,
  setCustomInstructions,
} from '@/api/ai-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { AI_FEATURE, type AIFeaturesStatusResponse } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';

export const useAiSettings = () => {
  const queryClient = useQueryClient();

  // ===== Queries =====

  const featuresStatusQuery = useQuery<AIFeaturesStatusResponse, Error>({
    queryKey: [...VUE_QUERY_CACHE_KEYS.aiFeaturesStatus],
    queryFn: getAiFeaturesStatus,
    staleTime: 30000, // 30 seconds
  });

  // ===== Mutations =====

  const setFeatureConfigMutation = useMutation({
    mutationFn: setAiFeatureConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });
    },
  });

  const resetFeatureConfigMutation = useMutation({
    mutationFn: resetAiFeatureConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });
    },
  });

  // ===== Custom Instructions =====

  const customInstructionsQuery = useQuery<CustomInstructionsResponse, Error>({
    queryKey: [...VUE_QUERY_CACHE_KEYS.aiCustomInstructions],
    queryFn: getCustomInstructions,
    staleTime: Infinity,
  });

  const setCustomInstructionsMutation = useMutation({
    mutationFn: setCustomInstructions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiCustomInstructions });
    },
  });

  // ===== Computed Helpers =====

  const customInstructions = computed(() => customInstructionsQuery.data.value?.instructions ?? null);

  const featuresStatus = computed(() => featuresStatusQuery.data.value?.features ?? []);
  const aiAllowance = computed(() => featuresStatusQuery.data.value?.aiAllowance ?? null);

  /**
   * An empty `featuresStatus` means nothing here: the request failed.
   * Screens reading a feature's config must show a retry, not a "not configured" state.
   */
  const featuresUnknown = computed(
    () => featuresStatusQuery.isError.value && featuresStatusQuery.data.value === undefined,
  );

  const getFeatureStatus = (feature: AI_FEATURE) => {
    return featuresStatus.value.find((f) => f.feature === feature);
  };

  return {
    // Query states
    isLoadingFeatures: featuresStatusQuery.isLoading,
    /** No answer yet — unlike `isLoadingFeatures`, stays true while the query is paused. */
    isFeaturesPending: featuresStatusQuery.isPending,

    // Data
    customInstructions,
    featuresStatus,
    aiAllowance,
    featuresUnknown,
    isRefetchingFeatures: featuresStatusQuery.isFetching,
    refetchFeatures: featuresStatusQuery.refetch,
    getFeatureStatus,

    // Feature config mutations
    setFeatureConfig: setFeatureConfigMutation.mutateAsync,
    isSettingFeatureConfig: setFeatureConfigMutation.isPending,

    resetFeatureConfig: resetFeatureConfigMutation.mutateAsync,
    isResettingFeatureConfig: resetFeatureConfigMutation.isPending,

    // Custom instructions mutations
    setCustomInstructions: setCustomInstructionsMutation.mutateAsync,
    isSettingCustomInstructions: setCustomInstructionsMutation.isPending,
  };
};
