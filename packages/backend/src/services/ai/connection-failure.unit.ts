import { AI_PROVIDER } from '@bt/shared/types';
import { i18nextReady } from '@i18n/index';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { APICallError, RetryError } from 'ai';

import { markConnectionInvalid } from '../user-settings/ai-connections';
import type { AIClientResult } from './ai-client-factory';
import { CliNotInstalledError, createCliApiError } from './cli/cli-errors';
import {
  describeRateLimited,
  isUserFixableEndpointDown,
  markConnectionRejected,
  markEndpointUnreachable,
  markModelNotServed,
} from './connection-failure';
import { suspendPrimaryServerKey } from './resolution-ladder';

jest.mock('../user-settings/ai-connections', () => ({
  getConnectionInfos: jest.fn(),
  markConnectionInvalid: jest.fn(),
}));
jest.mock('./resolution-ladder', () => ({
  ...jest.requireActual<typeof import('./resolution-ladder')>('./resolution-ladder'),
  suspendPrimaryServerKey: jest.fn(),
}));

const USER_ID = 1;

const client = ({ provider, usingUserKey }: { provider: AI_PROVIDER; usingUserKey: boolean }) =>
  ({ provider, usingUserKey, modelId: `${provider}/some-model` }) as AIClientResult;

describe.each([
  ['markConnectionRejected', markConnectionRejected],
  ['markModelNotServed', markModelNotServed],
])('%s', (_name, mark) => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('suspends the Anthropic server key only when that key is the one that failed', async () => {
    const ownKey = await mark({
      userId: USER_ID,
      aiClient: client({ provider: AI_PROVIDER.anthropic, usingUserKey: true }),
    });
    await mark({ userId: USER_ID, aiClient: client({ provider: AI_PROVIDER.google, usingUserKey: false }) });
    expect(suspendPrimaryServerKey).not.toHaveBeenCalled();

    const serverKey = await mark({
      userId: USER_ID,
      aiClient: client({ provider: AI_PROVIDER.anthropic, usingUserKey: false }),
    });
    expect(suspendPrimaryServerKey).toHaveBeenCalledWith({ reason: ownKey });
    expect(serverKey).not.toBe(ownKey);
  });
});

const limitError = ({ resetsAt }: { resetsAt?: string }) =>
  createCliApiError({
    provider: AI_PROVIDER.claudeCode,
    type: 'usage_limit_reached',
    message: 'Claude Code usage limit reached',
    data: resetsAt ? { resetsAt } : undefined,
  });

type CliTestProvider = AI_PROVIDER.claudeCode | AI_PROVIDER.codex;

describe('subscription copy', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const cliClient = ({ provider }: { provider: CliTestProvider }) =>
    ({ ...client({ provider, usingUserKey: true }), connectionId: 'conn-1' }) as AIClientResult;

  describe('markConnectionRejected', () => {
    it.each<[CliTestProvider, string]>([
      [AI_PROVIDER.claudeCode, 'Claude Code'],
      [AI_PROVIDER.codex, 'Codex'],
    ])('asks a %s user to sign in again instead of naming an API key', async (provider, label) => {
      const message = await markConnectionRejected({ userId: USER_ID, aiClient: cliClient({ provider }) });

      expect(message).toContain(label);
      expect(message).toContain('Sign in again in Settings → AI');
      expect(message).not.toMatch(/API key/i);
      expect(markConnectionInvalid).toHaveBeenCalledWith({
        userId: USER_ID,
        connectionId: 'conn-1',
        errorMessage: message,
      });
    });

    it('keeps the API-key copy for a native provider', async () => {
      const message = await markConnectionRejected({
        userId: USER_ID,
        aiClient: client({ provider: AI_PROVIDER.openai, usingUserKey: true }),
      });

      expect(message).toMatch(/API key is not working/);
    });
  });

  describe('markEndpointUnreachable', () => {
    it.each<[CliTestProvider, string]>([
      [AI_PROVIDER.claudeCode, 'The Claude Code CLI is not installed in the backend image'],
      [AI_PROVIDER.codex, 'The Codex CLI is not installed in the backend image'],
    ])('names the missing CLI for %s and flags the connection', async (provider, expected) => {
      const message = await markEndpointUnreachable({ userId: USER_ID, aiClient: cliClient({ provider }) });

      expect(message).toContain(expected);
      expect(markConnectionInvalid).toHaveBeenCalledWith({
        userId: USER_ID,
        connectionId: 'conn-1',
        errorMessage: message,
      });
    });

    it('keeps the custom endpoint copy and flags a custom connection', async () => {
      const message = await markEndpointUnreachable({
        userId: USER_ID,
        aiClient: { ...client({ provider: AI_PROVIDER.custom, usingUserKey: true }), connectionId: 'conn-2' },
      });

      expect(message).toMatch(/custom AI endpoint did not respond/);
      expect(markConnectionInvalid).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-2' }));
    });

    it('flags nothing for a native provider', async () => {
      await markEndpointUnreachable({
        userId: USER_ID,
        aiClient: { ...client({ provider: AI_PROVIDER.openai, usingUserKey: true }), connectionId: 'conn-3' },
      });

      expect(markConnectionInvalid).not.toHaveBeenCalled();
    });
  });

  describe('describeRateLimited', () => {
    beforeAll(async () => {
      await i18nextReady;
    });

    it('names the subscription and its reset time in UTC', () => {
      const message = describeRateLimited({
        aiClient: cliClient({ provider: AI_PROVIDER.claudeCode }),
        cause: limitError({ resetsAt: '2026-10-17T14:30:45.000Z' }),
      });

      expect(message).toBe('Your Claude Code subscription usage limit is reached. It resets at 2026-10-17 14:30 UTC.');
    });

    it('says to wait for the reset when the CLI gave no time', () => {
      const message = describeRateLimited({
        aiClient: cliClient({ provider: AI_PROVIDER.codex }),
        cause: limitError({}),
      });

      expect(message).toBe('Your Codex subscription usage limit is reached. Try again after it resets.');
    });

    it('ignores a reset time that is not a date', () => {
      const message = describeRateLimited({
        aiClient: cliClient({ provider: AI_PROVIDER.codex }),
        cause: limitError({ resetsAt: 'tomorrow-ish' }),
      });

      expect(message).toContain('Try again after it resets');
    });

    it('keeps the per-minute copy for a native provider', () => {
      const message = describeRateLimited({
        aiClient: client({ provider: AI_PROVIDER.openai, usingUserKey: true }),
        cause: new Error('429'),
      });

      expect(message).toBe('AI provider rate limit reached. Please try again in a few minutes.');
    });
  });
});

describe('isUserFixableEndpointDown', () => {
  const notInstalled = new CliNotInstalledError({
    provider: AI_PROVIDER.claudeCode,
    cause: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
  });
  const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const connectionRefused = new APICallError({
    message: 'Cannot connect',
    url: 'http://localhost:1234',
    requestBodyValues: {},
    isRetryable: true,
  });

  it.each<[string, AI_PROVIDER, unknown, boolean]>([
    ['custom + a refused connection', AI_PROVIDER.custom, connectionRefused, true],
    ['custom + an abort', AI_PROVIDER.custom, abortError, true],
    ['claude-code + CliNotInstalledError', AI_PROVIDER.claudeCode, notInstalled, true],
    ['codex + CliNotInstalledError', AI_PROVIDER.codex, notInstalled, true],
    ['claude-code + AbortError', AI_PROVIDER.claudeCode, abortError, false],
    ['codex + TimeoutError', AI_PROVIDER.codex, timeoutError, false],
    ['claude-code + a status-less APICallError', AI_PROVIDER.claudeCode, connectionRefused, false],
    ['openai + a refused connection', AI_PROVIDER.openai, connectionRefused, false],
  ])('%s', (_name, provider, error, expected) => {
    expect(isUserFixableEndpointDown({ provider, error })).toBe(expected);
  });

  it('sees a missing CLI through the SDK retry wrapper', () => {
    const wrapped = new RetryError({ message: 'failed', reason: 'maxRetriesExceeded', errors: [notInstalled] });

    expect(isUserFixableEndpointDown({ provider: AI_PROVIDER.claudeCode, error: wrapped })).toBe(true);
  });
});
