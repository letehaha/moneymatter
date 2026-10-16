import { getCliAiAvailability } from '@/api/ai-settings';
import { config } from '@/common/config';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import type { CliAiAvailability } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';

/**
 * Whether the subscription providers (Claude Code, Codex) can be offered to the current user.
 * Only self-hosted backends can run the CLIs, so the request is skipped elsewhere; the endpoint
 * itself decides admin access. A failed fetch leaves `availability` null, which hides the presets.
 */
export const useCliAiAvailability = () => {
  const availabilityQuery = useQuery<CliAiAvailability, Error>({
    queryKey: [...VUE_QUERY_CACHE_KEYS.aiCliAvailability],
    queryFn: getCliAiAvailability,
    enabled: computed(() => config.isSelfHost),
    staleTime: Infinity,
    retry: false,
  });

  return {
    availability: computed(() => availabilityQuery.data.value ?? null),
    isLoadingAvailability: availabilityQuery.isLoading,
  };
};
