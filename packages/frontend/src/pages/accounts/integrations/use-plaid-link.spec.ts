import { connectProvider } from '@/api/bank-data-providers';
import { createPlaidLinkToken } from '@/api/plaid';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

import { usePlaidLink } from './use-plaid-link';
import { openPlaidLink } from './utils/plaid-link';

const user = vi.hoisted(() => ({ id: 101 }));

vi.mock('@/api/plaid', () => ({ createPlaidLinkToken: vi.fn() }));
vi.mock('@/api/bank-data-providers', () => ({ connectProvider: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ user }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: vi.fn() }),
}));
vi.mock('@tanstack/vue-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('./utils/plaid-link', () => ({ openPlaidLink: vi.fn() }));

const scopes: EffectScope[] = [];
const startFlow = () => {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(usePlaidLink)!;
};

const OAUTH_RETURN = 'https://money.example/plaid-callback?oauth_state_id=test';

// Mimic leaving the original document for the bank without completing or exiting Link.
const leaveForBank = async () => {
  const opened = Promise.withResolvers<void>();
  vi.mocked(openPlaidLink).mockImplementationOnce(async ({ beforeOpen, signal }) => {
    await beforeOpen();
    const result = Promise.withResolvers<{ status: 'cancelled' }>();
    signal.addEventListener('abort', () => result.resolve({ status: 'cancelled' }), { once: true });
    opened.resolve();
    return result.promise;
  });
  void startFlow().run();
  await opened.promise;
};

describe('Plaid Link', () => {
  beforeEach(() => {
    user.id = 101;
    vi.resetAllMocks();
    vi.mocked(createPlaidLinkToken).mockResolvedValue({ linkToken: 'link-sandbox-test' });
  });

  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    sessionStorage.clear();
  });

  it('does not exchange a second token while the connection is being saved', async () => {
    const receipt = Promise.withResolvers<Awaited<ReturnType<typeof connectProvider>>>();
    vi.mocked(openPlaidLink).mockResolvedValue({ status: 'success', publicToken: 'public-sandbox-test' });
    vi.mocked(connectProvider).mockReturnValue(receipt.promise);

    const flow = startFlow();
    const result = flow.run();
    await vi.waitFor(() =>
      expect(connectProvider).toHaveBeenCalledWith('plaid', { publicToken: 'public-sandbox-test' }, undefined, {
        silent: true,
      }),
    );
    const duplicate = flow.run();
    receipt.resolve({ connectionId: '42', message: '' });

    await expect(result).resolves.toMatchObject({ status: 'connected', connectionId: '42' });
    await expect(duplicate).resolves.toBeUndefined();
    expect(createPlaidLinkToken).toHaveBeenCalledTimes(1);
    expect(connectProvider).toHaveBeenCalledTimes(1);
  });

  it('ignores a token response after the user cancels before Link opens', async () => {
    const token = Promise.withResolvers<{ linkToken: string }>();
    vi.mocked(createPlaidLinkToken).mockReturnValue(token.promise);
    const flow = startFlow();

    const result = flow.run();
    flow.cancel();
    token.resolve({ linkToken: 'link-sandbox-late' });

    await expect(result).resolves.toBeUndefined();
    expect(openPlaidLink).not.toHaveBeenCalled();
  });

  it('resumes initial Link with the original token once and exchanges the public token', async () => {
    await leaveForBank();
    vi.mocked(openPlaidLink).mockResolvedValue({ status: 'success', publicToken: 'public-sandbox-test' });
    vi.mocked(connectProvider).mockResolvedValue({ connectionId: '42', message: '' });
    const flow = startFlow();

    await expect(flow.run({ receivedRedirectUri: OAUTH_RETURN })).resolves.toEqual({
      status: 'connected',
      connectionId: '42',
    });
    expect(openPlaidLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ linkToken: 'link-sandbox-test', receivedRedirectUri: OAUTH_RETURN }),
    );
    expect(connectProvider).toHaveBeenCalledWith('plaid', { publicToken: 'public-sandbox-test' }, undefined, {
      silent: true,
    });
    await expect(flow.run({ receivedRedirectUri: OAUTH_RETURN })).resolves.toEqual({ status: 'unavailable' });
    expect(createPlaidLinkToken).toHaveBeenCalledTimes(1);
    expect(connectProvider).toHaveBeenCalledTimes(1);
  });

  it('fails with the Plaid display message when Link exits with an error', async () => {
    const cause = { error_code: 'INSTITUTION_DOWN', error_type: 'INSTITUTION_ERROR', display_message: 'Bank is down' };
    vi.mocked(openPlaidLink).mockRejectedValue(new Error('Plaid Link did not complete', { cause }));

    await expect(startFlow().run()).resolves.toEqual({ status: 'failed', message: 'Bank is down' });
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it.each([
    [API_ERROR_CODES.validationError, 'Plaid is not configured'],
    [API_ERROR_CODES.unexpected, undefined],
  ])('shows the backend message only for expected API errors (%s)', async (code, message) => {
    vi.mocked(openPlaidLink).mockResolvedValue({ status: 'success', publicToken: 'public-sandbox-test' });
    vi.mocked(connectProvider).mockRejectedValue(
      new ApiErrorResponseError('Plaid is not configured', { code, message: 'Plaid is not configured' }),
    );

    await expect(startFlow().run()).resolves.toEqual({ status: 'failed', message });
  });

  it('does not resume Link under a different signed-in user', async () => {
    await leaveForBank();
    user.id = 202;

    await expect(startFlow().run({ receivedRedirectUri: OAUTH_RETURN })).resolves.toEqual({ status: 'unavailable' });
    expect(openPlaidLink).toHaveBeenCalledTimes(1);
    expect(connectProvider).not.toHaveBeenCalled();
  });
});
