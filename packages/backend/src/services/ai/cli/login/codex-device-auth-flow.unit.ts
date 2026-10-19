import { describe, expect, it, jest } from '@jest/globals';
import { useFakeAiClis } from '@tests/helpers/ai-cli';
import { existsSync } from 'fs';

import { startCodexDeviceAuthFlow } from './codex-device-auth-flow';
import { DEFAULT_LOGIN_TIMEOUTS } from './login-flow';

jest.mock('@i18n/index', () => ({
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));

// These tests start real fake-CLI processes in PTYs; jest's default 5 s is too tight on a loaded runner, and
// fake timers cannot help with a child process. Each flow fails with its own message before this timeout does.
jest.setTimeout(30_000);

const VERIFICATION = { authUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH1' };

describe('startCodexDeviceAuthFlow', () => {
  const fakes = useFakeAiClis();

  it('returns the URL and device code, then the auth.json the CLI wrote', async () => {
    const flow = startCodexDeviceAuthFlow();

    expect(await flow.ready).toEqual(VERIFICATION);

    const { credential, credentialExpiresAt } = await flow.result;

    expect(JSON.parse(credential).tokens.refresh_token).toBe('rt-fake-initial');
    expect(credentialExpiresAt).toBeUndefined();
    expect(flow.submitCode).toBeUndefined();

    const run = fakes.getRun();

    expect(run).toMatchObject({
      argv: ['login', '--device-auth', '-c', 'cli_auth_credentials_store="file"'],
      mode: 'login',
    });
    // A private CODEX_HOME, removed once the credential was read.
    expect(existsSync(run.codexHome as string)).toBe(false);
  });

  it('yields the full URL and code, never a prefix, when the CLI writes them in pieces', async () => {
    fakes.setScenario({ scenario: 'split-chunks' });

    const flow = startCodexDeviceAuthFlow();

    expect(await flow.ready).toEqual(VERIFICATION);
    expect(JSON.parse((await flow.result).credential).tokens.refresh_token).toBe('rt-fake-initial');
  });

  it('fails with the CLI output when the sign-in is denied', async () => {
    fakes.setScenario({ scenario: 'denied' });

    const flow = startCodexDeviceAuthFlow();

    await flow.ready;

    await expect(flow.result).rejects.toThrow(/ai\.cliLoginFailed.*access_denied/);
  });

  it('fails when no URL shows up in time', async () => {
    fakes.setScenario({ scenario: 'no-url' });

    const flow = startCodexDeviceAuthFlow({ timeouts: { ...DEFAULT_LOGIN_TIMEOUTS, urlMs: 400 } });

    await expect(flow.ready).rejects.toThrow('ai.cliLoginNoUrl');
  });

  it('fails when the CLI does not finish within the completion timeout', async () => {
    const flow = startCodexDeviceAuthFlow({ timeouts: { ...DEFAULT_LOGIN_TIMEOUTS, completionMs: 20 } });

    await flow.ready;

    await expect(flow.result).rejects.toThrow('ai.cliLoginTimedOut');
  });

  it('cancel ends the flow', async () => {
    const flow = startCodexDeviceAuthFlow({ timeouts: { ...DEFAULT_LOGIN_TIMEOUTS, completionMs: 60 * 1000 } });

    await flow.ready;
    flow.cancel();

    await expect(flow.result).rejects.toThrow();
  });
});
