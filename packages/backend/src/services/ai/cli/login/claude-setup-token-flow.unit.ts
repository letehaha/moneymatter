import { describe, expect, it, jest } from '@jest/globals';
import { useFakeAiClis } from '@tests/helpers/ai-cli';
import { existsSync } from 'fs';

import { sanitizeClaudeCode, startClaudeSetupTokenFlow } from './claude-setup-token-flow';
import { DEFAULT_LOGIN_TIMEOUTS } from './login-flow';

jest.mock('@i18n/index', () => ({
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));

const AUTH_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=fake-state';
// These tests start real fake-CLI processes in PTYs; jest's default 5 s is too tight on a loaded runner, and
// fake timers cannot help with a child process. Each flow fails with its own message before this timeout does.
jest.setTimeout(30_000);

const TOKEN = 'sk-ant-oat01-FAKE0123456789abcdefghijklmnopqrstuvwxyz';

describe('startClaudeSetupTokenFlow', () => {
  const fakes = useFakeAiClis();

  it('returns the authorize URL, takes the pasted code and yields the token', async () => {
    const flow = startClaudeSetupTokenFlow();

    expect(await flow.ready).toEqual({ authUrl: AUTH_URL });

    flow.submitCode!({ code: '  good-code  ' });

    const { credential, credentialExpiresAt } = await flow.result;
    const yearMs = 365 * 24 * 60 * 60 * 1000;

    expect(credential).toBe(TOKEN);
    expect(new Date(credentialExpiresAt!).getTime() - Date.now()).toBeGreaterThan(yearMs - 60 * 1000);
    expect(new Date(credentialExpiresAt!).getTime() - Date.now()).toBeLessThanOrEqual(yearMs);

    const run = fakes.getRun();

    expect(run).toMatchObject({ argv: ['setup-token'], mode: 'setup-token', code: 'good-code', browser: '/bin/true' });
    expect(run.envKeys).not.toEqual(expect.arrayContaining(['ANTHROPIC_API_KEY']));
    // A private home, removed once the flow finished.
    expect(run.home).not.toBe(process.env.HOME);
    expect(existsSync(run.home as string)).toBe(false);
  });

  it('yields the full URL and token, never a prefix, when the CLI writes them in pieces', async () => {
    fakes.setScenario({ scenario: 'split-chunks' });

    const flow = startClaudeSetupTokenFlow();

    expect(await flow.ready).toEqual({ authUrl: AUTH_URL });

    flow.submitCode!({ code: 'good-code' });

    expect((await flow.result).credential).toBe(TOKEN);
  });

  it('accepts a token printed as the last bytes before the CLI exits', async () => {
    fakes.setScenario({ scenario: 'token-at-exit' });

    const flow = startClaudeSetupTokenFlow();

    await flow.ready;
    flow.submitCode!({ code: 'good-code' });

    expect((await flow.result).credential).toBe(TOKEN);
  });

  it('fails with a redacted message when the CLI rejects the code', async () => {
    const flow = startClaudeSetupTokenFlow();

    await flow.ready;
    flow.submitCode!({ code: 'bad-code' });

    const error = await flow.result.catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('ai.cliLoginFailed');
    expect((error as Error).message).toContain('Invalid code');
    expect((error as Error).message).not.toContain('bad-code');
    expect((error as Error).message).not.toContain('sk-ant-');
  });

  it('fails when no URL shows up in time', async () => {
    fakes.setScenario({ scenario: 'no-url' });

    const flow = startClaudeSetupTokenFlow({ timeouts: { ...DEFAULT_LOGIN_TIMEOUTS, urlMs: 400 } });

    await expect(flow.ready).rejects.toThrow('ai.cliLoginNoUrl');
    await expect(flow.result).rejects.toThrow('ai.cliLoginNoUrl');
  });

  it('fails when the token does not show up in time after the code', async () => {
    fakes.setScenario({ scenario: 'no-token' });

    const flow = startClaudeSetupTokenFlow({ timeouts: { ...DEFAULT_LOGIN_TIMEOUTS, tokenMs: 400 } });

    await flow.ready;
    flow.submitCode!({ code: 'good-code' });

    await expect(flow.result).rejects.toThrow('ai.cliLoginTimedOut');
  });

  it('fails when the CLI exits before printing the URL', async () => {
    process.env.AI_CLI_CLAUDE_PATH = '/bin/false';

    const flow = startClaudeSetupTokenFlow();

    await expect(flow.ready).rejects.toThrow('ai.cliLoginFailed');
  });

  it('fails when the CLI binary does not exist', async () => {
    process.env.AI_CLI_CLAUDE_PATH = '/nonexistent/claude';

    const flow = startClaudeSetupTokenFlow();

    await expect(flow.ready).rejects.toThrow(/ai\.cliLogin(CouldNotStart|Failed)/);
  });

  it('rejects a second code once one was submitted', async () => {
    const flow = startClaudeSetupTokenFlow();

    await flow.ready;
    flow.submitCode!({ code: 'good-code' });

    expect(() => flow.submitCode!({ code: 'good-code' })).toThrow('ai.cliAuthSessionNoCodeStep');

    await flow.result;
  });

  it('rejects a code that is empty or has control characters and keeps waiting', async () => {
    const flow = startClaudeSetupTokenFlow();

    await flow.ready;

    expect(() => flow.submitCode!({ code: '   ' })).toThrow('ai.cliLoginCodeInvalid');
    expect(() => flow.submitCode!({ code: 'abc\u0007def' })).toThrow('ai.cliLoginCodeInvalid');

    flow.submitCode!({ code: 'good-code' });

    expect((await flow.result).credential).toBe(TOKEN);
  });

  it('cancel ends the flow and removes the private home', async () => {
    const flow = startClaudeSetupTokenFlow();

    await flow.ready;
    flow.cancel();

    await expect(flow.result).rejects.toThrow('ai.cliLoginFailed');
  });
});

describe('sanitizeClaudeCode', () => {
  it('trims and keeps printable ASCII', () => {
    expect(sanitizeClaudeCode({ code: '  abc#DEF-123_xyz  ' })).toBe('abc#DEF-123_xyz');
  });

  it.each(['', '   ', 'a\nb', 'a\u0000b', 'café', 'a'.repeat(501)])('rejects %j', (code) => {
    expect(() => sanitizeClaudeCode({ code })).toThrow('ai.cliLoginCodeInvalid');
  });
});
