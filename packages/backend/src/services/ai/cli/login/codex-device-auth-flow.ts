import { AI_PROVIDER } from '@bt/shared/types';
import { t } from '@i18n/index';
import { readFile } from 'fs/promises';
import path from 'path';

import { getCliBinaryPath } from '../cli-binaries';
import { buildCodexEnv } from '../cli-env';
import { withTempDir } from '../cli-workdir';
import { createDeferred, DEFAULT_LOGIN_TIMEOUTS, LoginCredential, LoginFlow, LoginTimeouts } from './login-flow';
import { PtySession, startPtySession } from './pty-session';

/** Delimited (see the PTY matching rule): a field counts only once whitespace or the PTY's exit follows it. */
const VERIFICATION_URL_PATTERN = /https:\/\/\S+(?=\s)/;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}(?=\s)/;

const FAILURE_OUTPUT_LINES = 5;

function describeFailure({ session }: { session: PtySession }): Error {
  const output = session.getLastLines({ count: FAILURE_OUTPUT_LINES }).join(' | ');

  return new Error(t({ key: 'ai.cliLoginFailed', variables: { output } }));
}

/**
 * `codex login --device-auth` in a PTY with a private `CODEX_HOME`: prints a verification URL and
 * a one-time code, then waits for the user to approve in the browser and writes `auth.json`.
 */
export function startCodexDeviceAuthFlow({
  timeouts = DEFAULT_LOGIN_TIMEOUTS,
}: { timeouts?: LoginTimeouts } = {}): LoginFlow {
  const ready = createDeferred<{ authUrl: string; userCode: string }>();
  let isCancelled = false;
  let activeSession: PtySession | undefined;

  const result: Promise<LoginCredential> = withTempDir({
    prefix: 'mm-codex-login',
    run: async ({ dir }) => {
      let session: PtySession;

      try {
        session = startPtySession({
          command: getCliBinaryPath({ provider: AI_PROVIDER.codex }),
          args: ['login', '--device-auth', '-c', 'cli_auth_credentials_store="file"'],
          env: { ...buildCodexEnv({ codexHome: dir }), TERM: 'xterm-256color' },
          cwd: dir,
        });
      } catch {
        throw new Error(t({ key: 'ai.cliLoginCouldNotStart' }));
      }

      activeSession = session;

      try {
        if (isCancelled) session.kill();

        const deadline = Date.now() + timeouts.urlMs;
        const remaining = () => Math.max(deadline - Date.now(), 0);

        const url = await session.waitFor({ pattern: VERIFICATION_URL_PATTERN, timeoutMs: remaining() });

        if (!url.matched) {
          throw url.reason === 'timeout' ? new Error(t({ key: 'ai.cliLoginNoUrl' })) : describeFailure({ session });
        }

        const code = await session.waitFor({ pattern: DEVICE_CODE_PATTERN, timeoutMs: remaining() });

        if (!code.matched) {
          throw code.reason === 'timeout' ? new Error(t({ key: 'ai.cliLoginNoUrl' })) : describeFailure({ session });
        }

        ready.resolve({ authUrl: url.match[0], userCode: code.match[0] });

        let completionTimer: NodeJS.Timeout | undefined;
        const outcome = await Promise.race([
          session.exited,
          new Promise<null>((resolve) => {
            completionTimer = setTimeout(() => resolve(null), timeouts.completionMs);
          }),
        ]).finally(() => clearTimeout(completionTimer));

        if (outcome === null) throw new Error(t({ key: 'ai.cliLoginTimedOut' }));
        if (outcome.exitCode !== 0) throw describeFailure({ session });

        let authJson: string;

        try {
          authJson = await readFile(path.join(dir, 'auth.json'), 'utf8');
          JSON.parse(authJson);
        } catch {
          throw describeFailure({ session });
        }

        return { credential: authJson };
      } finally {
        session.kill();
      }
    },
  });

  result.catch((error) => ready.reject(error));

  return {
    ready: ready.promise,
    result,
    cancel: () => {
      isCancelled = true;
      activeSession?.kill();
    },
  };
}
