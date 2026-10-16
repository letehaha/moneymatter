const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/** Test-only variables the fake CLIs read; never forwarded outside `NODE_ENV=test`. */
const FAKE_CLI_ENV_VARS = ['MM_FAKE_CLI_SCENARIO', 'MM_FAKE_CLI_RESPONSE_FILE', 'MM_FAKE_CLI_STATE_DIR'] as const;

const OPTIONAL_PASSTHROUGH_VARS = ['LANG', 'TZ', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'] as const;

/**
 * The child environment is assembled from scratch instead of spread from `process.env`, so an
 * operator's `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` can't outrank the subscription credential and
 * app secrets (database, JWT) never reach the CLI process.
 */
function buildBaseEnv({ home }: { home: string }): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH || DEFAULT_PATH, HOME: home };

  for (const name of OPTIONAL_PASSTHROUGH_VARS) {
    const value = process.env[name];
    if (value) env[name] = value;
  }

  if (process.env.NODE_ENV === 'test') {
    for (const name of FAKE_CLI_ENV_VARS) {
      const value = process.env[name];
      if (value) env[name] = value;
    }
  }

  return env;
}

/** `home` doubles as `CLAUDE_CONFIG_DIR`: a private directory per invocation. */
export function buildClaudeEnv({ token, home }: { token?: string; home: string }): Record<string, string> {
  const env: Record<string, string> = {
    ...buildBaseEnv({ home }),
    CLAUDE_CONFIG_DIR: home,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };

  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;

  return env;
}

export function buildCodexEnv({ codexHome }: { codexHome: string }): Record<string, string> {
  return { ...buildBaseEnv({ home: codexHome }), CODEX_HOME: codexHome, RUST_LOG: 'error' };
}

/**
 * The app's global `ProcessEnv` type requires `NODE_ENV`, which a scrubbed child environment
 * deliberately doesn't carry; this is the one place that gap is bridged for `child_process`.
 */
export const toSpawnEnv = ({ env }: { env: Record<string, string> }) => env as unknown as NodeJS.ProcessEnv;
