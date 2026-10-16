import { AI_PROVIDER } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

import { getCliBinaryPath } from '../cli-binaries';
import { buildClaudeEnv } from '../cli-env';
import { withTempDir } from '../cli-workdir';
import { createDeferred, DEFAULT_LOGIN_TIMEOUTS, LoginCredential, LoginFlow, LoginTimeouts } from './login-flow';
import { PtySession, startPtySession } from './pty-session';

/** Delimited (see the PTY matching rule): a field counts only once whitespace or the PTY's exit follows it. */
const AUTH_URL_PATTERN = /https:\/\/\S*oauth\S*(?=\s)/;
const TOKEN_PATTERN = /sk-ant-oat\w*-[A-Za-z0-9_-]{20,}(?=\s)/;

const MAX_CODE_LENGTH = 500;
const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const FAILURE_OUTPUT_LINES = 5;

/** The pasted code: printable ASCII, trimmed, and not empty. */
export function sanitizeClaudeCode({ code }: { code: string }): string {
  const trimmed = code.trim();

  if (!trimmed || trimmed.length > MAX_CODE_LENGTH || !/^[\x20-\x7E]+$/.test(trimmed)) {
    throw new ValidationError({ message: t({ key: 'ai.cliLoginCodeInvalid' }) });
  }

  return trimmed;
}

function describeFailure({ session, hiddenText }: { session: PtySession; hiddenText?: string }): Error {
  let output = session.getLastLines({ count: FAILURE_OUTPUT_LINES }).join(' | ');

  // The terminal echoes the pasted code back; it is single-use but still not worth showing.
  if (hiddenText) output = output.split(hiddenText).join('[redacted]');

  return new Error(t({ key: 'ai.cliLoginFailed', variables: { output } }));
}

/**
 * `claude setup-token` in a PTY: prints an authorization URL, takes the code the user pastes back
 * and then prints a one-year OAuth token. The CLI gets a private HOME/CLAUDE_CONFIG_DIR and a
 * browser stub, so nothing is opened on the server.
 */
export function startClaudeSetupTokenFlow({
  timeouts = DEFAULT_LOGIN_TIMEOUTS,
}: { timeouts?: LoginTimeouts } = {}): LoginFlow {
  const ready = createDeferred<{ authUrl: string }>();
  const codeSubmitted = createDeferred<string>();
  let isCancelled = false;
  let hasCode = false;
  let activeSession: PtySession | undefined;

  const result: Promise<LoginCredential> = withTempDir({
    prefix: 'mm-claude-login',
    run: async ({ dir }) => {
      let session: PtySession;

      try {
        session = startPtySession({
          command: getCliBinaryPath({ provider: AI_PROVIDER.claudeCode }),
          args: ['setup-token'],
          env: { ...buildClaudeEnv({ home: dir }), BROWSER: '/bin/true', TERM: 'xterm-256color' },
          cwd: dir,
        });
      } catch {
        throw new Error(t({ key: 'ai.cliLoginCouldNotStart' }));
      }

      activeSession = session;

      try {
        if (isCancelled) session.kill();

        const url = await session.waitFor({ pattern: AUTH_URL_PATTERN, timeoutMs: timeouts.urlMs });

        if (!url.matched) {
          throw url.reason === 'timeout' ? new Error(t({ key: 'ai.cliLoginNoUrl' })) : describeFailure({ session });
        }

        ready.resolve({ authUrl: url.match[0] });

        const code = await Promise.race([codeSubmitted.promise, session.exited.then(() => null)]);

        if (code === null) throw describeFailure({ session });

        session.write({ data: `${code}\r` });

        const token = await session.waitFor({ pattern: TOKEN_PATTERN, timeoutMs: timeouts.tokenMs });

        if (!token.matched) {
          throw token.reason === 'timeout'
            ? new Error(t({ key: 'ai.cliLoginTimedOut' }))
            : describeFailure({ session, hiddenText: code });
        }

        return {
          credential: token.match[0],
          credentialExpiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
        };
      } finally {
        session.kill();
      }
    },
  });

  // A flow that dies before the URL appears fails `ready` with the same error.
  result.catch((error) => ready.reject(error));

  return {
    ready: ready.promise,
    result,
    submitCode: ({ code }) => {
      const sanitized = sanitizeClaudeCode({ code });

      if (hasCode) throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNoCodeStep' }) });

      hasCode = true;
      codeSubmitted.resolve(sanitized);
    },
    cancel: () => {
      isCancelled = true;
      activeSession?.kill();
    },
  };
}
