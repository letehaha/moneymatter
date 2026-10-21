import { getCashFlow } from '@/api/stats';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useAccountsStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

import { getFireSeedWindow } from './derive-fire-seed';

/** Monthly cash flow of owned accounts over the seed window; the FIRE planner and goal feasibility share its cache. */
export const useFireSeedCashFlow = ({ now, enabled = true }: { now: Date; enabled?: MaybeRefOrGetter<boolean> }) => {
  const seedWindow = getFireSeedWindow({ now });
  const seedKey = format(seedWindow.from, 'yyyy-MM-dd');

  const { accounts } = storeToRefs(useAccountsStore());
  const ownedAccountIds = computed(() =>
    (accounts.value ?? []).filter((a) => !a.share || a.share.isOwner).map((a) => a.id),
  );

  const isEnabled = computed(() => toValue(enabled) && ownedAccountIds.value.length > 0);
  const queryKey = computed(() => [...VUE_QUERY_CACHE_KEYS.fireCashFlow, seedKey, ownedAccountIds.value]);
  // An empty accountIds list widens to every accessible account on the server.
  const params = () => ({
    ...seedWindow,
    granularity: 'monthly' as const,
    excludePlanned: true,
    accountIds: ownedAccountIds.value,
  });

  const query = useQuery({
    queryKey,
    queryFn: () => getCashFlow(params()),
    enabled: isEnabled,
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });

  return { query, queryKey, params, isEnabled, ownedAccountIds, seedWindow, seedKey };
};
