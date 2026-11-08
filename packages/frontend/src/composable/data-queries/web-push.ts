import * as pushApi from '@/api/web-push';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { SubscribePushRequest } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';

const PUSH_CONFIG_STALE_TIME = 1000 * 60 * 60;

/** Shared by `usePushConfig` and `ensurePushConfig`, so both hit one cache entry. */
export const pushConfigQueryOptions = {
  queryKey: [...VUE_QUERY_CACHE_KEYS.pushConfig],
  queryFn: pushApi.getPushConfig,
  staleTime: PUSH_CONFIG_STALE_TIME,
};

export const usePushConfig = (queryOptions = {}) => {
  const query = useQuery({ ...pushConfigQueryOptions, ...queryOptions });

  return { ...query, config: query.data };
};

export const usePushDevices = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.pushDevices,
    queryFn: pushApi.getPushDevices,
    staleTime: 1000 * 60,
    ...queryOptions,
  });

  return {
    ...query,
    devices: query.data,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.pushDevices }),
  };
};

const useInvalidatePushDevices = () => {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.pushDevices });
};

export const useSubscribePush = () => {
  const invalidateDevices = useInvalidatePushDevices();

  return useMutation({
    mutationFn: ({ payload, silent }: { payload: SubscribePushRequest; silent?: boolean }) =>
      pushApi.subscribePush({ payload, silent }),
    onSuccess: invalidateDevices,
  });
};

export const useUnsubscribePush = () => {
  const invalidateDevices = useInvalidatePushDevices();

  return useMutation({
    mutationFn: ({ endpoint, silent }: { endpoint: string; silent?: boolean }) =>
      pushApi.unsubscribePush({ endpoint, silent }),
    onSuccess: invalidateDevices,
  });
};

export const useRemovePushDevice = () => {
  const invalidateDevices = useInvalidatePushDevices();

  return useMutation({
    mutationFn: ({ id }: { id: string }) => pushApi.removePushDevice({ id }),
    onSuccess: invalidateDevices,
  });
};

export const useSendTestPush = () => {
  const invalidateDevices = useInvalidatePushDevices();

  return useMutation({
    mutationFn: pushApi.sendTestPush,
    // A test removes devices the push service reports gone and stamps `lastSuccessAt` on the rest.
    onSuccess: invalidateDevices,
  });
};
