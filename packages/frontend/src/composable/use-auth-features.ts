import { getAuthFeatures } from '@/api/auth';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { getOAuthProviderName } from '@/components/auth/oauth-providers';
import { OAUTH_PROVIDER } from '@bt/shared/types';
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

  const getProviderName = ({ provider }: { provider: OAUTH_PROVIDER }) =>
    getOAuthProviderName({ provider, oidcName: oidcProvider.value?.name });

  return { authFeatures, isEmailEnabled, oidcProvider, getProviderName };
};
