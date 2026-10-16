import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, AI_PROVIDER, type CliAuthSessionInfo, type CliAuthSessionStatus } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const { startMock, getMock, submitMock, cancelMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  getMock: vi.fn(),
  submitMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock('@/api/ai-settings', () => ({
  startCliAuthSession: startMock,
  getCliAuthSession: getMock,
  submitCliAuthCode: submitMock,
  cancelCliAuthSession: cancelMock,
}));

import { useCliSignIn } from './use-cli-sign-in';

const POLL_MS = 2000;
const AUTH_URL = 'https://claude.ai/oauth/authorize?code=true';

const makeSession = (overrides: Partial<CliAuthSessionInfo> = {}): CliAuthSessionInfo => ({
  id: 'session-1',
  provider: AI_PROVIDER.claudeCode,
  status: 'awaiting-user',
  authUrl: AUTH_URL,
  expiresAt: '2026-10-17T12:15:00.000Z',
  ...overrides,
});

const withStatus = (status: CliAuthSessionStatus, overrides: Partial<CliAuthSessionInfo> = {}) =>
  makeSession({ status, ...overrides });

const apiError = ({ code, message }: { code: API_ERROR_CODES; message: string }) =>
  new ApiErrorResponseError(message, { code, message });

let scope: ReturnType<typeof effectScope>;
let fakeTab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
let openSpy: ReturnType<typeof vi.spyOn>;

const setup = ({
  provider = AI_PROVIDER.claudeCode,
}: { provider?: AI_PROVIDER.claudeCode | AI_PROVIDER.codex } = {}) => {
  const providerRef = ref<AI_PROVIDER.claudeCode | AI_PROVIDER.codex>(provider);
  const signIn = scope.run(() => useCliSignIn({ provider: providerRef }))!;
  return { signIn, providerRef };
};

describe('useCliSignIn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startMock.mockReset();
    getMock.mockReset();
    submitMock.mockReset();
    cancelMock.mockReset().mockResolvedValue(undefined);
    fakeTab = { opener: 'page', location: { href: 'about:blank' }, close: vi.fn() };
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeTab as unknown as Window);
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    openSpy.mockRestore();
    vi.useRealTimers();
  });

  describe('start', () => {
    it('opens the login tab synchronously, then points it at the URL the backend returns', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();

      const started = signIn.start();

      // Before the request resolves: the tab already exists and the state is `starting`.
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(fakeTab.opener).toBeNull();
      expect(signIn.state.value).toBe('starting');
      expect(fakeTab.location.href).toBe('about:blank');

      await started;

      expect(startMock).toHaveBeenCalledWith({ provider: AI_PROVIDER.claudeCode });
      expect(signIn.state.value).toBe('awaiting-user');
      expect(signIn.authUrl.value).toBe(AUTH_URL);
      expect(fakeTab.location.href).toBe(AUTH_URL);
      expect(fakeTab.close).not.toHaveBeenCalled();
    });

    it('still works when the browser blocks the popup', async () => {
      openSpy.mockReturnValue(null);
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();

      await signIn.start();

      expect(signIn.state.value).toBe('awaiting-user');
      expect(signIn.authUrl.value).toBe(AUTH_URL);
    });

    it('exposes the device code of a Codex sign-in', async () => {
      startMock.mockResolvedValue(
        withStatus('awaiting-user', {
          provider: AI_PROVIDER.codex,
          authUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
        }),
      );
      const { signIn } = setup({ provider: AI_PROVIDER.codex });

      await signIn.start();

      expect(startMock).toHaveBeenCalledWith({ provider: AI_PROVIDER.codex });
      expect(signIn.userCode.value).toBe('ABCD-1234');
    });

    it('fails and closes the unused tab when the backend rejects the start', async () => {
      startMock.mockRejectedValue(apiError({ code: API_ERROR_CODES.tooManyRequests, message: 'Too many sign-ins' }));
      const { signIn } = setup();

      await signIn.start();

      expect(signIn.state.value).toBe('failed');
      expect(signIn.error.value).toBe('Too many sign-ins');
      expect(fakeTab.close).toHaveBeenCalledTimes(1);
      expect(getMock).not.toHaveBeenCalled();
    });

    it('never opens a URL that is not https', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user', { authUrl: 'javascript:alert(1)' }));
      const { signIn } = setup();

      await signIn.start();

      expect(signIn.authUrl.value).toBeNull();
      expect(fakeTab.location.href).toBe('about:blank');
    });

    it('closes the tab when the login already failed on start', async () => {
      startMock.mockResolvedValue(withStatus('failed', { authUrl: undefined, error: 'claude is not installed' }));
      const { signIn } = setup();

      await signIn.start();

      expect(signIn.state.value).toBe('failed');
      expect(signIn.error.value).toBe('claude is not installed');
      expect(fakeTab.close).toHaveBeenCalledTimes(1);
    });

    it('ignores a second start while a sign-in is running', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();
      await signIn.start();

      await signIn.start();

      expect(startMock).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh sign-in after a failed one', async () => {
      startMock.mockResolvedValueOnce(withStatus('failed', { authUrl: undefined, error: 'boom' }));
      const { signIn } = setup();
      await signIn.start();

      startMock.mockResolvedValueOnce(withStatus('awaiting-user', { id: 'session-2' }));
      await signIn.start();

      expect(signIn.state.value).toBe('awaiting-user');
      expect(signIn.sessionId.value).toBe('session-2');
      expect(signIn.error.value).toBeNull();
      // A failed session is already dead on the server.
      expect(cancelMock).not.toHaveBeenCalled();
    });
  });

  describe('polling', () => {
    it('polls every 2 seconds while awaiting the user and follows the session to verifying', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      getMock.mockResolvedValue(withStatus('verifying'));
      const { signIn } = setup();
      await signIn.start();

      expect(getMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(POLL_MS);

      expect(getMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('verifying');

      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(getMock).toHaveBeenCalledTimes(2);
    });

    it('stops polling once the sign-in succeeded', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user', { provider: AI_PROVIDER.codex }));
      getMock.mockResolvedValueOnce(withStatus('verifying')).mockResolvedValueOnce(withStatus('succeeded'));
      const { signIn } = setup({ provider: AI_PROVIDER.codex });
      await signIn.start();

      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
      expect(signIn.state.value).toBe('succeeded');
      expect(signIn.sessionId.value).toBe('session-1');

      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(getMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['failed', 'The code was rejected'],
      ['expired', undefined],
    ] as const)('stops polling once the sign-in %s', async (status, message) => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      getMock.mockResolvedValue(withStatus(status, { error: message }));
      const { signIn } = setup();
      await signIn.start();

      await vi.advanceTimersByTimeAsync(POLL_MS);

      expect(signIn.state.value).toBe(status);
      expect(signIn.error.value).toBe(message ?? null);
      expect(fakeTab.close).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(getMock).toHaveBeenCalledTimes(1);
    });

    it('treats a session the backend no longer knows as expired', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      getMock.mockRejectedValue(apiError({ code: API_ERROR_CODES.notFound, message: 'Not found' }));
      const { signIn } = setup();
      await signIn.start();

      await vi.advanceTimersByTimeAsync(POLL_MS);

      expect(signIn.state.value).toBe('expired');
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(getMock).toHaveBeenCalledTimes(1);
    });

    it('rides out a failed poll and gives up after repeated ones', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      getMock.mockRejectedValue(new Error('network down'));
      const { signIn } = setup();
      await signIn.start();

      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(signIn.state.value).toBe('awaiting-user');

      await vi.advanceTimersByTimeAsync(POLL_MS * 10);
      expect(signIn.state.value).toBe('failed');
      expect(getMock).toHaveBeenCalledTimes(5);
    });

    it('stops polling when the owning scope is disposed and cancels the running session', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      getMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();
      await signIn.start();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(getMock).toHaveBeenCalledTimes(1);

      scope.stop();
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
    });

    it('leaves a succeeded session alone on dispose, since the save that follows consumes it', async () => {
      startMock.mockResolvedValue(withStatus('succeeded', { authUrl: undefined }));
      const { signIn } = setup();
      await signIn.start();

      scope.stop();

      expect(cancelMock).not.toHaveBeenCalled();
    });

    it('drops a poll response that lands after the sign-in was cancelled', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      let resolvePoll: (info: CliAuthSessionInfo) => void = () => {};
      getMock.mockReturnValue(new Promise<CliAuthSessionInfo>((resolve) => (resolvePoll = resolve)));
      const { signIn } = setup();
      await signIn.start();
      await vi.advanceTimersByTimeAsync(POLL_MS);

      signIn.cancel();
      resolvePoll(withStatus('succeeded'));
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);

      expect(signIn.state.value).toBe('idle');
      expect(getMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('submitCode', () => {
    it('sends the code, moves to verifying and keeps polling until the CLI finishes', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      submitMock.mockResolvedValue(withStatus('verifying'));
      getMock.mockResolvedValue(withStatus('succeeded'));
      const { signIn } = setup();
      await signIn.start();

      const submitted = signIn.submitCode({ code: 'abc#123' });
      expect(signIn.state.value).toBe('verifying');
      await submitted;

      expect(submitMock).toHaveBeenCalledWith({ id: 'session-1', code: 'abc#123' });
      expect(signIn.state.value).toBe('verifying');

      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(signIn.state.value).toBe('succeeded');
    });

    it('returns to awaiting the code when the request is rejected, so the user can retry', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      submitMock.mockRejectedValue(apiError({ code: API_ERROR_CODES.validationError, message: 'Invalid code' }));
      const { signIn } = setup();
      await signIn.start();

      await signIn.submitCode({ code: 'x' });

      expect(signIn.state.value).toBe('awaiting-user');
      expect(signIn.error.value).toBe('Invalid code');
    });

    it('reports an expired session when the backend no longer has it', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      submitMock.mockRejectedValue(apiError({ code: API_ERROR_CODES.notFound, message: 'Not found' }));
      const { signIn } = setup();
      await signIn.start();

      await signIn.submitCode({ code: 'x' });

      expect(signIn.state.value).toBe('expired');
    });

    it('ends in failed with the CLI message when the code is refused', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      submitMock.mockResolvedValue(withStatus('failed', { error: 'OAuth error: invalid code' }));
      const { signIn } = setup();
      await signIn.start();

      await signIn.submitCode({ code: 'bad-code' });

      expect(signIn.state.value).toBe('failed');
      expect(signIn.error.value).toBe('OAuth error: invalid code');
    });

    it('does nothing outside awaiting-user', async () => {
      const { signIn } = setup();

      await signIn.submitCode({ code: 'x' });

      expect(submitMock).not.toHaveBeenCalled();
      expect(signIn.state.value).toBe('idle');
    });
  });

  describe('cancel and reset', () => {
    it('cancels the server session and returns to idle', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();
      await signIn.start();

      signIn.cancel();

      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('idle');
      expect(signIn.session.value).toBeNull();
      expect(signIn.authUrl.value).toBeNull();
    });

    it('discards a session whose start request had not returned yet', async () => {
      let resolveStart: (info: CliAuthSessionInfo) => void = () => {};
      startMock.mockReturnValue(new Promise<CliAuthSessionInfo>((resolve) => (resolveStart = resolve)));
      const { signIn } = setup();
      const started = signIn.start();

      signIn.cancel();
      expect(cancelMock).not.toHaveBeenCalled();

      resolveStart(withStatus('awaiting-user'));
      await started;

      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('idle');
      expect(fakeTab.close).toHaveBeenCalled();
    });

    it('leaves a finished sign-in alone on cancel', async () => {
      startMock.mockResolvedValue(withStatus('succeeded', { authUrl: undefined }));
      const { signIn } = setup();
      await signIn.start();

      signIn.cancel();

      expect(signIn.state.value).toBe('succeeded');
      expect(cancelMock).not.toHaveBeenCalled();
    });

    it('reset cancels a running sign-in', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn } = setup();
      await signIn.start();

      signIn.reset();

      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('idle');
    });

    it('reset drops a succeeded sign-in that was never saved', async () => {
      startMock.mockResolvedValue(withStatus('succeeded', { authUrl: undefined }));
      const { signIn } = setup();
      await signIn.start();

      signIn.reset();

      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('idle');
      expect(signIn.sessionId.value).toBeNull();
    });

    it('reset after a failure only clears the local state', async () => {
      startMock.mockResolvedValue(withStatus('failed', { authUrl: undefined, error: 'boom' }));
      const { signIn } = setup();
      await signIn.start();

      signIn.reset();

      expect(cancelMock).not.toHaveBeenCalled();
      expect(signIn.state.value).toBe('idle');
      expect(signIn.error.value).toBeNull();
    });

    it('a cancel request that fails does not surface', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      cancelMock.mockRejectedValue(new Error('gone'));
      const { signIn } = setup();
      await signIn.start();

      expect(() => signIn.cancel()).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(signIn.state.value).toBe('idle');
    });

    it('resets when the provider changes', async () => {
      startMock.mockResolvedValue(withStatus('awaiting-user'));
      const { signIn, providerRef } = setup();
      await signIn.start();

      providerRef.value = AI_PROVIDER.codex;
      await nextTick();

      expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
      expect(signIn.state.value).toBe('idle');
    });
  });
});
