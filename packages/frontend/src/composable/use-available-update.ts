import { type LatestRelease, getLatestRelease } from '@/api/github-releases';
import { config } from '@/common/config';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { addBreadcrumb } from '@/lib/sentry';
import { useQuery } from '@tanstack/vue-query';
import { type ComputedRef, computed } from 'vue';

export const isNewerVersion = ({ latest, current }: { latest: string; current: string }): boolean =>
  latest.localeCompare(current, undefined, { numeric: true }) > 0;

export const useAvailableUpdate = (): ComputedRef<LatestRelease | null> => {
  const { data } = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.latestRelease,
    // Resolving to null on failure keeps a failed check cached, so air-gapped or rate-limited
    // instances don't refetch on every focus/mount.
    queryFn: () =>
      getLatestRelease().catch((error: unknown) => {
        addBreadcrumb({ category: 'update-check', message: String(error), level: 'info' });
        return null;
      }),
    enabled: config.isSelfHost,
    staleTime: Infinity,
  });

  return computed(() =>
    data.value && isNewerVersion({ latest: data.value.version, current: __APP_RELEASE__ }) ? data.value : null,
  );
};
