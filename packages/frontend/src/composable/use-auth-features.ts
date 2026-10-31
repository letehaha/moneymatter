import { getAuthFeatures } from '@/api/auth';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';

/** Server-side auth capabilities (email, generic OIDC) the auth pages adapt to. */
export const useAuthFeatures = () => {
  const { data: authFeatures } = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.authFeatures,
    queryFn: getAuthFeatures,
  });

  const isEmailEnabled = computed(() => authFeatures.value?.emailEnabled === true);
  // null until loaded and when the server has no OIDC provider configured
  const oidcProvider = computed(() => authFeatures.value?.oidc ?? null);

  return { authFeatures, isEmailEnabled, oidcProvider };
};
