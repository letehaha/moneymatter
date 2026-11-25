import { getSecurityPrices } from '@/api/securities';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useQueries, useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

const SECURITY_PRICES_STALE_TIME = 5 * 60 * 1000;

const securityPricesQuery = ({ securityId }: { securityId: string }) => ({
  queryKey: [...VUE_QUERY_CACHE_KEYS.securityPrices, securityId] as const,
  queryFn: () => getSecurityPrices({ securityId }),
  staleTime: SECURITY_PRICES_STALE_TIME,
});

/** Full daily close history; periods are sliced client-side so one request serves every range. */
export const useSecurityPrices = ({ securityId }: { securityId: MaybeRefOrGetter<string> }) =>
  useQuery(() => ({
    ...securityPricesQuery({ securityId: toValue(securityId) }),
    enabled: Boolean(toValue(securityId)),
  }));

/** One full daily history per security, sharing the cache with `useSecurityPrices`. */
export const useSecuritiesPrices = ({ securityIds }: { securityIds: MaybeRefOrGetter<string[]> }) =>
  useQueries({
    queries: computed(() => toValue(securityIds).map((securityId) => securityPricesQuery({ securityId }))),
  });
