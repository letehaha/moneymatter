import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { buildClaudeEnv, buildCodexEnv } from './cli-env';

const LEAKY_VARS = {
  ANTHROPIC_API_KEY: 'sk-ant-api-secret',
  ANTHROPIC_AUTH_TOKEN: 'anthropic-auth-secret',
  OPENAI_API_KEY: 'sk-openai-secret',
  APPLICATION_JWT_SECRET: 'jwt-secret',
  APPLICATION_DB_PASSWORD: 'db-secret',
};
const FAKE_VARS = {
  MM_FAKE_CLI_SCENARIO: 'rate-limit',
  MM_FAKE_CLI_RESPONSE_FILE: '/tmp/responses.json',
  MM_FAKE_CLI_STATE_DIR: '/tmp/fake-state',
};

describe('cli env builders', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, LEAKY_VARS, FAKE_VARS, { LANG: 'en_US.UTF-8', TZ: 'UTC' });
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it('never forwards API keys or app secrets from process.env', () => {
    for (const env of [
      buildClaudeEnv({ token: 'sk-ant-oat01-abc', home: '/tmp/home' }),
      buildCodexEnv({ codexHome: '/tmp/codex-home' }),
    ]) {
      for (const name of Object.keys(LEAKY_VARS)) {
        expect(env).not.toHaveProperty(name);
      }
    }
  });

  it('builds the Claude env with the token and a private config dir', () => {
    const env = buildClaudeEnv({ token: 'sk-ant-oat01-abc', home: '/tmp/home' });

    expect(env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abc',
      CLAUDE_CONFIG_DIR: '/tmp/home',
      HOME: '/tmp/home',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
    });
    expect(env.PATH).toBeTruthy();
  });

  it('omits the token when none is given', () => {
    expect(buildClaudeEnv({ home: '/tmp/home' })).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('builds the Codex env around CODEX_HOME', () => {
    expect(buildCodexEnv({ codexHome: '/tmp/codex-home' })).toMatchObject({
      CODEX_HOME: '/tmp/codex-home',
      HOME: '/tmp/codex-home',
      RUST_LOG: 'error',
    });
  });

  it('forwards the fake CLI variables only under NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(buildClaudeEnv({ home: '/tmp/home' })).toMatchObject(FAKE_VARS);
    expect(buildCodexEnv({ codexHome: '/tmp/codex-home' })).toMatchObject(FAKE_VARS);

    process.env.NODE_ENV = 'production';

    try {
      for (const env of [buildClaudeEnv({ home: '/tmp/home' }), buildCodexEnv({ codexHome: '/tmp/codex-home' })]) {
        for (const name of Object.keys(FAKE_VARS)) {
          expect(env).not.toHaveProperty(name);
        }
      }
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('passes the CA bundle variables through when set', () => {
    process.env.SSL_CERT_FILE = '/etc/ssl/ca.pem';
    process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/extra.pem';

    expect(buildCodexEnv({ codexHome: '/tmp/codex-home' })).toMatchObject({
      SSL_CERT_FILE: '/etc/ssl/ca.pem',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem',
    });
  });

  it('passes USE_BUILTIN_RIPGREP through so the image can use its system ripgrep', () => {
    process.env.USE_BUILTIN_RIPGREP = '0';

    expect(buildClaudeEnv({ home: '/tmp/home' })).toMatchObject({ USE_BUILTIN_RIPGREP: '0' });
  });
});
