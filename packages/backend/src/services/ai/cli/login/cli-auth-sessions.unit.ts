import { AI_PROVIDER } from '@bt/shared/types';
import { decryptToken } from '@common/utils/encryption';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, TooManyRequests, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { useFakeAiClis } from '@tests/helpers/ai-cli';

import {
  cancelSession,
  consumeCredential,
  getSession,
  peekCredential,
  replaceSessionCredential,
  resetCliAuthSessions,
  sessionCredentialSource,
  startSession,
  submitCode,
  sweepCliAuthSessions,
} from './cli-auth-sessions';
import type { LoginFlow } from './login-flow';
import { DEFAULT_LOGIN_TIMEOUTS } from './login-flow';

jest.mock('@i18n/index', () => ({
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));

/** Every flow the registry started, with `cancel` wrapped so tests can see that it ran. */
const mockStartedFlows: LoginFlow[] = [];

jest.mock('./claude-setup-token-flow', () => {
  const actual = jest.requireActual<typeof import('./claude-setup-token-flow')>('./claude-setup-token-flow');

  return {
    ...actual,
    startClaudeSetupTokenFlow: (...args: Parameters<typeof actual.startClaudeSetupTokenFlow>) => {
      const flow = actual.startClaudeSetupTokenFlow(...args);
      const cancel = jest.fn(flow.cancel);

      mockStartedFlows.push({ ...flow, cancel });

      return { ...flow, cancel };
    },
  };
});

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Sign-in tests start real fake-CLI processes in PTYs, several per test; jest's default 5 s is too tight on a
// loaded machine. `waitForStatus` fails with its own message before this timeout does.
jest.setTimeout(30_000);

const WAIT_FOR_STATUS_DEADLINE_MS = 10_000;

const TOKEN = 'sk-ant-oat01-FAKE0123456789abcdefghijklmnopqrstuvwxyz';
const { claudeCode, codex } = AI_PROVIDER;

const waitForStatus = async ({ userId, sessionId, status }: { userId: number; sessionId: string; status: string }) => {
  const deadline = Date.now() + WAIT_FOR_STATUS_DEADLINE_MS;

  for (;;) {
    const info = getSession({ userId, sessionId });

    if (info.status === status) return info;
    if (Date.now() > deadline) throw new Error(`Session stayed ${info.status}, wanted ${status}`);

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const signInWithClaude = async ({ userId = 1 }: { userId?: number } = {}) => {
  const started = await startSession({ userId, provider: claudeCode });

  submitCode({ userId, sessionId: started.id, code: 'good-code' });

  await waitForStatus({ userId, sessionId: started.id, status: 'succeeded' });

  return started.id;
};

const signInWithCodex = async ({ userId = 1 }: { userId?: number } = {}) => {
  const started = await startSession({ userId, provider: codex });

  await waitForStatus({ userId, sessionId: started.id, status: 'succeeded' });

  return started.id;
};

describe('cli auth sessions', () => {
  useFakeAiClis();

  afterEach(() => {
    mockStartedFlows.length = 0;
    jest.restoreAllMocks();
    jest.clearAllMocks();
    resetCliAuthSessions();
  });

  describe('Claude', () => {
    it('walks starting -> awaiting-user -> verifying -> succeeded without leaking the token', async () => {
      const started = await startSession({ userId: 1, provider: claudeCode });

      expect(started).toMatchObject({ provider: claudeCode, status: 'awaiting-user' });
      expect(started.authUrl).toContain('/oauth/authorize');
      expect(started.userCode).toBeUndefined();

      const verifying = submitCode({ userId: 1, sessionId: started.id, code: 'good-code' });

      expect(verifying.status).toBe('verifying');

      const done = await waitForStatus({ userId: 1, sessionId: started.id, status: 'succeeded' });

      expect(JSON.stringify(done)).not.toContain('sk-ant-');
      expect(done.error).toBeUndefined();

      const { keyEncrypted, credentialExpiresAt } = peekCredential({
        userId: 1,
        sessionId: started.id,
        provider: claudeCode,
      });

      expect(keyEncrypted).not.toContain('sk-ant');
      expect(decryptToken(keyEncrypted)).toBe(TOKEN);
      expect(new Date(credentialExpiresAt!).getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 60 * 60 * 1000);
    });

    it('fails with a redacted message on a bad code', async () => {
      const started = await startSession({ userId: 1, provider: claudeCode });

      submitCode({ userId: 1, sessionId: started.id, code: 'bad-code' });

      const failed = await waitForStatus({ userId: 1, sessionId: started.id, status: 'failed' });

      expect(failed.error).toContain('Invalid code');
      expect(failed.error).not.toContain('sk-ant-');
      expect(() => peekCredential({ userId: 1, sessionId: started.id, provider: claudeCode })).toThrow(ValidationError);
    });

    it('answers failed when no URL appears within the timeout', async () => {
      process.env.MM_FAKE_CLI_SCENARIO = 'no-url';

      const info = await startSession({
        userId: 1,
        provider: claudeCode,
        flowTimeouts: { ...DEFAULT_LOGIN_TIMEOUTS, urlMs: 400 },
      });

      expect(info.status).toBe('failed');
      expect(info.error).toBe('ai.cliLoginNoUrl');
      expect(getSession({ userId: 1, sessionId: info.id }).status).toBe('failed');
    });

    it('keeps waiting when the pasted code is invalid', async () => {
      const started = await startSession({ userId: 1, provider: claudeCode });

      expect(() => submitCode({ userId: 1, sessionId: started.id, code: '  ' })).toThrow(ValidationError);
      expect(getSession({ userId: 1, sessionId: started.id }).status).toBe('awaiting-user');
    });

    it('refuses a second code while verifying', async () => {
      const started = await startSession({ userId: 1, provider: claudeCode });

      submitCode({ userId: 1, sessionId: started.id, code: 'good-code' });

      expect(() => submitCode({ userId: 1, sessionId: started.id, code: 'good-code' })).toThrow(ValidationError);

      // Lets the fake CLI finish, so it is not still writing to its state dir when the test tears down.
      await waitForStatus({ userId: 1, sessionId: started.id, status: 'succeeded' });
    });
  });

  describe('Codex', () => {
    it('returns the URL and device code, then succeeds on its own', async () => {
      const started = await startSession({ userId: 1, provider: codex });

      expect(started).toMatchObject({
        provider: codex,
        status: 'awaiting-user',
        authUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH1',
      });

      await waitForStatus({ userId: 1, sessionId: started.id, status: 'succeeded' });

      const { keyEncrypted, credentialExpiresAt } = peekCredential({
        userId: 1,
        sessionId: started.id,
        provider: codex,
      });

      expect(JSON.parse(decryptToken(keyEncrypted)).tokens.refresh_token).toBe('rt-fake-initial');
      expect(credentialExpiresAt).toBeUndefined();
    });

    it('fails when the sign-in is denied', async () => {
      process.env.MM_FAKE_CLI_SCENARIO = 'denied';

      const started = await startSession({ userId: 1, provider: codex });
      const failed = await waitForStatus({ userId: 1, sessionId: started.id, status: 'failed' });

      expect(failed.error).toContain('access_denied');
    });

    it('refuses a pasted code', async () => {
      const started = await startSession({ userId: 1, provider: codex });

      expect(() => submitCode({ userId: 1, sessionId: started.id, code: 'abc' })).toThrow(ValidationError);
    });
  });

  describe('lifecycle', () => {
    it('cancel removes the session and kills the login', async () => {
      const started = await startSession({ userId: 1, provider: claudeCode });

      const flow = mockStartedFlows[0]!;

      cancelSession({ userId: 1, sessionId: started.id });

      expect(flow.cancel).toHaveBeenCalledTimes(1);
      // The login ended: its PTY exited and the temp dir is cleaned up before the result settles.
      await expect(flow.result).rejects.toThrow();
      expect(() => getSession({ userId: 1, sessionId: started.id })).toThrow(NotFoundError);
      expect(() => cancelSession({ userId: 1, sessionId: started.id })).toThrow(NotFoundError);
    });

    it('a second start by the same user for the same provider cancels the first', async () => {
      const first = await startSession({ userId: 1, provider: claudeCode });
      const otherProvider = await startSession({ userId: 1, provider: codex });
      const otherUser = await startSession({ userId: 2, provider: claudeCode });
      const second = await startSession({ userId: 1, provider: claudeCode });

      expect(second.id).not.toBe(first.id);
      expect(() => getSession({ userId: 1, sessionId: first.id })).toThrow(NotFoundError);
      expect(getSession({ userId: 1, sessionId: second.id }).status).toBe('awaiting-user');
      expect(getSession({ userId: 1, sessionId: otherProvider.id })).toMatchObject({ provider: codex });
      expect(getSession({ userId: 2, sessionId: otherUser.id })).toMatchObject({ provider: claudeCode });
    });

    it('allows at most 3 logins at once', async () => {
      await startSession({ userId: 1, provider: claudeCode });
      await startSession({ userId: 2, provider: claudeCode });
      await startSession({ userId: 3, provider: claudeCode });

      await expect(startSession({ userId: 4, provider: claudeCode })).rejects.toThrow(TooManyRequests);
      // Replacing one's own session does not count against the cap.
      await expect(startSession({ userId: 3, provider: claudeCode })).resolves.toMatchObject({
        status: 'awaiting-user',
      });
    });

    it('a finished sign-in does not hold a login slot', async () => {
      await signInWithCodex({ userId: 1 });
      await startSession({ userId: 2, provider: claudeCode });
      await startSession({ userId: 3, provider: claudeCode });

      await expect(startSession({ userId: 4, provider: claudeCode })).resolves.toMatchObject({
        status: 'awaiting-user',
      });
    });

    it('expires after the TTL: a waiting session reads expired, a finished one loses its credential', async () => {
      const waiting = await startSession({ userId: 1, provider: claudeCode });
      const finished = await signInWithCodex({ userId: 2 });
      const realNow = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(realNow + 16 * 60 * 1000);

      expect(getSession({ userId: 1, sessionId: waiting.id }).status).toBe('expired');
      const waitingFlow = mockStartedFlows[0]!;

      expect(waitingFlow.cancel).toHaveBeenCalledTimes(1);
      await expect(waitingFlow.result).rejects.toThrow();
      expect(getSession({ userId: 2, sessionId: finished }).status).toBe('expired');
      expect(() => peekCredential({ userId: 2, sessionId: finished, provider: codex })).toThrow(ValidationError);
    });

    it('gives a finished sign-in a fresh TTL, so a slow approval still leaves time to save', async () => {
      const realNow = Date.now();
      const now = jest.spyOn(Date, 'now');
      const started = await startSession({ userId: 1, provider: claudeCode });

      now.mockReturnValue(realNow + 14 * 60 * 1000);
      submitCode({ userId: 1, sessionId: started.id, code: 'good-code' });
      const done = await waitForStatus({ userId: 1, sessionId: started.id, status: 'succeeded' });

      expect(new Date(done.expiresAt).getTime()).toBe(realNow + 29 * 60 * 1000);

      now.mockReturnValue(realNow + 28 * 60 * 1000);
      expect(peekCredential({ userId: 1, sessionId: started.id, provider: claudeCode }).keyEncrypted).toBeTruthy();

      now.mockReturnValue(realNow + 30 * 60 * 1000);
      expect(() => peekCredential({ userId: 1, sessionId: started.id, provider: claudeCode })).toThrow(ValidationError);
    });

    it('the sweep drops sessions that stayed expired past the retention period', async () => {
      const waiting = await startSession({ userId: 1, provider: claudeCode });
      const realNow = Date.now();
      const now = jest.spyOn(Date, 'now');

      now.mockReturnValue(realNow + 16 * 60 * 1000);
      sweepCliAuthSessions();
      expect(getSession({ userId: 1, sessionId: waiting.id }).status).toBe('expired');

      now.mockReturnValue(realNow + 21 * 60 * 1000);
      sweepCliAuthSessions();
      expect(() => getSession({ userId: 1, sessionId: waiting.id })).toThrow(NotFoundError);
    });
  });

  describe('ownership', () => {
    it('a foreign user cannot read, submit to, cancel, peek or consume a session', async () => {
      const waiting = await startSession({ userId: 1, provider: claudeCode });
      const finished = await signInWithCodex({ userId: 1 });

      expect(() => getSession({ userId: 2, sessionId: waiting.id })).toThrow(NotFoundError);
      expect(() => submitCode({ userId: 2, sessionId: waiting.id, code: 'good-code' })).toThrow(NotFoundError);
      expect(() => cancelSession({ userId: 2, sessionId: waiting.id })).toThrow(NotFoundError);
      expect(() => peekCredential({ userId: 2, sessionId: finished, provider: codex })).toThrow(ValidationError);
      expect(() => consumeCredential({ userId: 2, sessionId: finished, provider: codex })).toThrow(ValidationError);
      // Untouched by the attempts.
      expect(getSession({ userId: 1, sessionId: waiting.id }).status).toBe('awaiting-user');
      expect(peekCredential({ userId: 1, sessionId: finished, provider: codex }).keyEncrypted).toBeTruthy();
    });

    it('an unknown id is a 404 to read and a 422 to peek', () => {
      expect(() => getSession({ userId: 1, sessionId: 'missing' })).toThrow(NotFoundError);
      expect(() => peekCredential({ userId: 1, sessionId: 'missing', provider: codex })).toThrow(ValidationError);
    });
  });

  describe('peek and consume', () => {
    it('peeking twice leaves the credential, consuming returns it once', async () => {
      const id = await signInWithClaude();

      const first = peekCredential({ userId: 1, sessionId: id, provider: claudeCode });
      const second = peekCredential({ userId: 1, sessionId: id, provider: claudeCode });
      const consumed = consumeCredential({ userId: 1, sessionId: id, provider: claudeCode });

      expect(second).toEqual(first);
      expect(consumed).toEqual(first);
      expect(() => consumeCredential({ userId: 1, sessionId: id, provider: claudeCode })).toThrow(ValidationError);
      expect(() => peekCredential({ userId: 1, sessionId: id, provider: claudeCode })).toThrow(ValidationError);
    });

    it('refuses another provider and a session that is not finished', async () => {
      const finished = await signInWithClaude();
      const waiting = await startSession({ userId: 2, provider: claudeCode });

      expect(() => peekCredential({ userId: 1, sessionId: finished, provider: codex })).toThrow(ValidationError);
      expect(() => peekCredential({ userId: 2, sessionId: waiting.id, provider: claudeCode })).toThrow(ValidationError);
    });
  });

  describe('replaceSessionCredential', () => {
    it('swaps the credential when the revision still matches', async () => {
      const id = await signInWithCodex();
      const { keyEncrypted } = peekCredential({ userId: 1, sessionId: id, provider: codex });

      await replaceSessionCredential({
        userId: 1,
        sessionId: id,
        expectedRevision: keyEncrypted,
        credential: '{"tokens":{"refresh_token":"rt-2"}}',
      });

      const after = peekCredential({ userId: 1, sessionId: id, provider: codex });

      expect(after.keyEncrypted).not.toBe(keyEncrypted);
      expect(decryptToken(after.keyEncrypted)).toBe('{"tokens":{"refresh_token":"rt-2"}}');
    });

    it('changes nothing for a stale revision and logs a warning', async () => {
      const id = await signInWithCodex();
      const before = peekCredential({ userId: 1, sessionId: id, provider: codex });

      await replaceSessionCredential({
        userId: 1,
        sessionId: id,
        expectedRevision: 'stale-ciphertext',
        credential: 'new',
      });

      expect(peekCredential({ userId: 1, sessionId: id, provider: codex })).toEqual(before);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('changes nothing on a consumed, cancelled or foreign session', async () => {
      const consumed = await signInWithCodex({ userId: 1 });
      const { keyEncrypted } = consumeCredential({ userId: 1, sessionId: consumed, provider: codex });
      const foreign = await signInWithCodex({ userId: 2 });
      const foreignBefore = peekCredential({ userId: 2, sessionId: foreign, provider: codex });

      await replaceSessionCredential({
        userId: 1,
        sessionId: consumed,
        expectedRevision: keyEncrypted,
        credential: 'x',
      });
      await replaceSessionCredential({
        userId: 1,
        sessionId: foreign,
        expectedRevision: foreignBefore.keyEncrypted,
        credential: 'x',
      });

      expect(() => peekCredential({ userId: 1, sessionId: consumed, provider: codex })).toThrow(ValidationError);
      expect(peekCredential({ userId: 2, sessionId: foreign, provider: codex })).toEqual(foreignBefore);
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('sessionCredentialSource', () => {
    it('loads the decrypted credential with its ciphertext as revision and saves compare-and-swap', async () => {
      const id = await signInWithClaude();
      const source = sessionCredentialSource({ userId: 1, sessionId: id, provider: claudeCode });

      expect(source.connectionKey).toBe(`session:${id}`);

      const { credential, revision } = await source.load();

      expect(credential).toBe(TOKEN);
      expect(revision).toBe(peekCredential({ userId: 1, sessionId: id, provider: claudeCode }).keyEncrypted);

      await source.save!({ credential: 'refreshed', loadedRevision: revision });

      expect((await source.load()).credential).toBe('refreshed');

      await source.save!({ credential: 'stale-write', loadedRevision: revision });

      expect((await source.load()).credential).toBe('refreshed');
    });

    it('refuses to load once the session was consumed', async () => {
      const id = await signInWithClaude();
      const source = sessionCredentialSource({ userId: 1, sessionId: id, provider: claudeCode });

      consumeCredential({ userId: 1, sessionId: id, provider: claudeCode });

      await expect(source.load()).rejects.toThrow(ValidationError);
    });
  });
});
