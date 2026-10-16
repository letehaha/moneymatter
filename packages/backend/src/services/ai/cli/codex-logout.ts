import { AI_PROVIDER } from '@bt/shared/types';
import { logger } from '@js/utils/logger';

import { getCliBinaryPath } from './cli-binaries';
import { CliCredentialSource, runWithCliCredential } from './cli-credential-run';
import { buildCodexEnv } from './cli-env';
import { runCliProcess } from './cli-process';
import { CLI_LOGOUT_RUN_TIMEOUT_MS } from './cli-run-limiter';
import { withTempDir } from './cli-workdir';

/** How long a disconnect waits for a running job on the connection before it signs out regardless. */
const LOGOUT_MAX_WAIT_MS = 30 * 1000;

/**
 * Best-effort `codex logout` so the tokens of a disconnected connection are revoked. It goes through
 * `runWithCliCredential` like every other use of the stored credential (slot held, freshest credential).
 * Any failure is only logged: the connection is deleted either way.
 */
export async function logoutCodexConnection({ source }: { source: CliCredentialSource }): Promise<void> {
  try {
    await runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: CLI_LOGOUT_RUN_TIMEOUT_MS,
      maxWaitMs: LOGOUT_MAX_WAIT_MS,
      run: ({ codexHome, signal }) =>
        withTempDir({
          prefix: 'mm-codex-logout',
          run: async ({ dir }) => {
            const result = await runCliProcess({
              provider: AI_PROVIDER.codex,
              command: getCliBinaryPath({ provider: AI_PROVIDER.codex }),
              args: ['logout', '-c', 'cli_auth_credentials_store="file"'],
              env: buildCodexEnv({ codexHome: codexHome! }),
              cwd: dir,
              signal,
            });

            if (result.exitCode !== 0) {
              logger.warn('codex logout exited with a failure, the tokens may stay valid', {
                exitCode: result.exitCode,
                stderr: result.stderrTail.slice(-300),
              });
            }
          },
        }),
    });
  } catch (error) {
    logger.warn('codex logout could not be run, the tokens may stay valid', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
