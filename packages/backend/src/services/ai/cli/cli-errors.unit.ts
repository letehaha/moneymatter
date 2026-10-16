import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { APICallError, RetryError } from 'ai';

import { classifyAiCallFailure } from '../ai-error-classifiers';
import {
  CliNotInstalledError,
  createToolUseBlockedError,
  isCliNotInstalledError,
  mapCliFailure,
  mapSpawnError,
  redactCliSecrets,
} from './cli-errors';

const provider = AI_PROVIDER.claudeCode;

const map = (params: { text: string; apiErrorStatus?: number | null; exitCode?: number | null }) =>
  mapCliFailure({ provider, ...params });

describe('mapCliFailure', () => {
  it.each([
    ['not logged in', { text: 'Not logged in · Please run /login' }, 401, 'auth'],
    ['an expired OAuth token', { text: 'OAuth token has expired' }, 401, 'auth'],
    ['invalid_grant', { text: 'invalid_grant' }, 401, 'auth'],
    ['an upstream 401', { text: 'API Error', apiErrorStatus: 401 }, 401, 'auth'],
    ['a used refresh token', { text: 'refresh_token_failed: refresh token was already used' }, 401, 'auth'],
    ['a usage limit', { text: 'Claude AI usage limit reached|1893456000' }, 429, 'rate-limited'],
    ['usage_limit_reached', { text: '{"error":{"type":"usage_limit_reached"}}' }, 429, 'rate-limited'],
    ['an upstream 429', { text: 'API Error', apiErrorStatus: 429 }, 429, 'rate-limited'],
    [
      'an unknown model',
      { text: 'There is an issue with the selected model (x)', apiErrorStatus: 404 },
      404,
      'model-not-found',
    ],
    ['an unsupported model', { text: "The 'x' model is not supported when using Codex" }, 404, 'model-not-found'],
    ['an upstream 529', { text: 'API Error: 529 Overloaded', apiErrorStatus: 529 }, 503, 'temporary'],
    ['an overloaded message', { text: 'server_overloaded: retry later' }, 503, 'temporary'],
    ['an unmapped exit', { text: 'segfault', exitCode: 139 }, 502, 'temporary'],
  ])('maps %s', (_name, params, statusCode, kind) => {
    const error = map(params);

    expect(error).toBeInstanceOf(APICallError);
    expect(error.statusCode).toBe(statusCode);
    expect(error.url).toBe('cli://claude-code');
    expect(() => JSON.parse(error.responseBody!)).not.toThrow();
    expect(classifyAiCallFailure({ error }).kind).toBe(kind);
  });

  it('puts the reset time of a Claude usage limit in the message and data', () => {
    const error = map({ text: 'Claude AI usage limit reached|1893456000' });

    expect(error.message).toContain('2030-01-01T00:00:00.000Z');
    expect(error.data).toEqual({ resetsAt: '2030-01-01T00:00:00.000Z' });
  });

  it('reads the reset time of a Codex usage limit from resets_in_seconds', () => {
    const before = Date.now();
    const error = mapCliFailure({
      provider: AI_PROVIDER.codex,
      text: '{"error":{"type":"usage_limit_reached","resets_in_seconds":3600}}',
    });
    const { resetsAt } = error.data as { resetsAt: string };

    expect(error.url).toBe('cli://codex');
    expect(Date.parse(resetsAt)).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it('carries the exit code and the CLI message on an unmapped failure', () => {
    const error = map({ text: 'something odd', exitCode: 3 });

    expect(error.message).toBe('The Claude Code CLI exited with code 3: something odd');
  });

  it('redacts tokens from messages and response bodies', () => {
    const error = map({ text: 'boom sk-ant-oat01-abcdefghijklmnopqrstuvwxyz and "refresh_token":"abc123secret"' });

    expect(error.message).not.toContain('abcdefghijklmnop');
    expect(error.message).not.toContain('abc123secret');
    expect(error.responseBody).not.toContain('abcdefghijklmnop');
  });
});

describe('CliNotInstalledError', () => {
  it('maps a spawn ENOENT to a status-less error that reads as endpoint-down', () => {
    const error = mapSpawnError({
      provider,
      error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
    });

    expect(error).toBeInstanceOf(CliNotInstalledError);
    expect(error.statusCode).toBeUndefined();
    expect(isCliNotInstalledError({ error })).toBe(true);
    expect(classifyAiCallFailure({ error }).kind).toBe('endpoint-down');
  });

  it('is found through a RetryError wrapper', () => {
    const inner = new CliNotInstalledError({ provider, cause: new Error('ENOENT') });
    const wrapped = new RetryError({ message: 'retries exhausted', reason: 'maxRetriesExceeded', errors: [inner] });

    expect(isCliNotInstalledError({ error: wrapped })).toBe(true);
  });

  it('is not reported for an abort, a timeout or any other error', () => {
    expect(isCliNotInstalledError({ error: new DOMException('aborted', 'AbortError') })).toBe(false);
    expect(isCliNotInstalledError({ error: new DOMException('timed out', 'TimeoutError') })).toBe(false);
    expect(isCliNotInstalledError({ error: map({ text: 'x', exitCode: 1 }) })).toBe(false);
  });

  it('maps other spawn failures to a 502', () => {
    const error = mapSpawnError({ provider, error: Object.assign(new Error('EACCES'), { code: 'EACCES' }) });

    expect(error.statusCode).toBe(502);
    expect(isCliNotInstalledError({ error })).toBe(false);
  });
});

describe('createToolUseBlockedError', () => {
  it('is a 502 with the cli_tool_use_blocked type', () => {
    const error = createToolUseBlockedError({ provider, detail: 'Bash' });

    expect(error.statusCode).toBe(502);
    expect(JSON.parse(error.responseBody!).error.type).toBe('cli_tool_use_blocked');
    expect(classifyAiCallFailure({ error }).kind).toBe('temporary');
  });
});

describe('redactCliSecrets', () => {
  it('redacts Claude tokens, JWTs and token fields', () => {
    const text = redactCliSecrets({
      text: 'sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA eyJhbGciOiJSUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJl {"access_token":"tok123"}',
    });

    expect(text).not.toMatch(/AAAAAAAA|eyJhbGci|tok123/);
  });
});
