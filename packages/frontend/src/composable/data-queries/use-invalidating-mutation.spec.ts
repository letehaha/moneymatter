import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, type QueryKey, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useInvalidatingMutation } from './use-invalidating-mutation';

const addSuccessNotification = vi.fn();
const addErrorNotification = vi.fn();
const addNotification = vi.fn();

vi.mock('@/components/notification-center', () => ({
  NotificationType: { error: 'error' },
  useNotificationCenter: () => ({ addNotification, addSuccessNotification, addErrorNotification }),
}));

// Echoes the key so an assertion reads as the key the UI renders.
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const KEY_A: QueryKey = ['invalidating-mutation', 'a'];
const KEY_B: QueryKey = ['invalidating-mutation', 'b'];
const ERROR_KEY = 'errors.write';

interface Variables {
  value: number;
}

const mountMutation = ({
  mutationFn,
  successKey,
  successMessage,
  silentErrorCodes,
  persistentErrorId,
}: {
  mutationFn: (variables: Variables) => Promise<string>;
  successKey?: string;
  successMessage?: (data: string) => string;
  silentErrorCodes?: API_ERROR_CODES[];
  persistentErrorId?: string;
}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

  let mutation!: { mutateAsync: (variables: Variables) => Promise<string> };
  const Wrapper = defineComponent({
    setup() {
      mutation = useInvalidatingMutation<string, Variables>({
        mutationFn,
        invalidateKeys: [KEY_A, KEY_B],
        successKey,
        successMessage,
        errorKey: ERROR_KEY,
        silentErrorCodes,
        persistentErrorId,
      });
      return () => null;
    },
  });
  mount(Wrapper, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });

  return { mutation, invalidateQueries };
};

const apiError = ({ code, message }: { code: API_ERROR_CODES; message: string }) =>
  new ApiErrorResponseError('request failed', { code, message });

describe('useInvalidatingMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves only once every invalidate key has refetched', async () => {
    let releaseInvalidation!: () => void;
    const invalidation = new Promise<void>((resolve) => {
      releaseInvalidation = resolve;
    });
    const { mutation, invalidateQueries } = mountMutation({ mutationFn: () => Promise.resolve('saved') });
    invalidateQueries.mockImplementation(() => invalidation);

    let isSettled = false;
    const pending = mutation.mutateAsync({ value: 1 }).then(() => {
      isSettled = true;
    });
    await flushPromises();

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: KEY_A });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: KEY_B });
    expect(isSettled).toBe(false);

    releaseInvalidation();
    await pending;

    expect(isSettled).toBe(true);
  });

  it('announces the success key when one is given', async () => {
    const { mutation } = mountMutation({ mutationFn: () => Promise.resolve('saved'), successKey: 'toasts.saved' });

    await mutation.mutateAsync({ value: 1 });

    expect(addSuccessNotification).toHaveBeenCalledWith('toasts.saved');
  });

  it('builds the success toast from the response, over the success key', async () => {
    const { mutation } = mountMutation({
      mutationFn: () => Promise.resolve('3 rows'),
      successKey: 'toasts.saved',
      successMessage: (data) => `Merged ${data}`,
    });

    await mutation.mutateAsync({ value: 1 });

    expect(addSuccessNotification).toHaveBeenCalledTimes(1);
    expect(addSuccessNotification).toHaveBeenCalledWith('Merged 3 rows');
  });

  it('toasts the server message over the fallback key', async () => {
    const error = apiError({ code: API_ERROR_CODES.conflict, message: 'Name already taken' });
    const { mutation } = mountMutation({ mutationFn: () => Promise.reject(error) });

    await expect(mutation.mutateAsync({ value: 1 })).rejects.toBe(error);

    expect(addErrorNotification).toHaveBeenCalledWith('Name already taken');
  });

  it('keeps the error toast up under the given id when asked to', async () => {
    const error = apiError({ code: API_ERROR_CODES.conflict, message: 'Name already taken' });
    const { mutation } = mountMutation({ mutationFn: () => Promise.reject(error), persistentErrorId: 'write-error' });

    await expect(mutation.mutateAsync({ value: 1 })).rejects.toBe(error);

    expect(addNotification).toHaveBeenCalledWith({
      id: 'write-error',
      text: 'Name already taken',
      type: 'error',
      persistent: true,
    });
    expect(addErrorNotification).not.toHaveBeenCalled();
  });

  it('skips the toast for a code the caller renders itself', async () => {
    const error = apiError({ code: API_ERROR_CODES.conflict, message: 'Name already taken' });
    const { mutation } = mountMutation({
      mutationFn: () => Promise.reject(error),
      silentErrorCodes: [API_ERROR_CODES.conflict],
    });

    await expect(mutation.mutateAsync({ value: 1 })).rejects.toBe(error);

    expect(addErrorNotification).not.toHaveBeenCalled();
  });

  it('skips the toast on an expired session', async () => {
    const error = apiError({ code: API_ERROR_CODES.unauthorized, message: 'Session expired' });
    const { mutation } = mountMutation({ mutationFn: () => Promise.reject(error) });

    await expect(mutation.mutateAsync({ value: 1 })).rejects.toBe(error);

    expect(addErrorNotification).not.toHaveBeenCalled();
  });
});
