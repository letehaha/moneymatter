import { AI_PROVIDER, AICliProvider } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { execFile } from 'child_process';

import { toSpawnEnv } from './cli-env';

const CLI_BINARY_ENV: Record<AICliProvider, string> = {
  [AI_PROVIDER.claudeCode]: 'AI_CLI_CLAUDE_PATH',
  [AI_PROVIDER.codex]: 'AI_CLI_CODEX_PATH',
};

const CLI_BINARY_DEFAULT: Record<AICliProvider, string> = {
  [AI_PROVIDER.claudeCode]: 'claude',
  [AI_PROVIDER.codex]: 'codex',
};

const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const VERSION_PROBE_TIMEOUT_MS = 10 * 1000;

/** Keyed by the resolved binary path, so pointing `AI_CLI_*_PATH` elsewhere is a cache miss. */
const versionCache = new Map<string, { version: string | null; expiresAt: number }>();

export function getCliBinaryPath({ provider }: { provider: AICliProvider }): string {
  return process.env[CLI_BINARY_ENV[provider]] || CLI_BINARY_DEFAULT[provider];
}

function probeVersion({ binaryPath }: { binaryPath: string }): Promise<{ version: string | null; cacheable: boolean }> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['--version'],
      { timeout: VERSION_PROBE_TIMEOUT_MS, env: toSpawnEnv({ env: { PATH: process.env.PATH ?? '' } }) },
      (error, stdout) => {
        if (error) {
          const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';

          if (!isMissing) logger.warn('CLI version probe failed', { binaryPath, error: error.message });

          return resolve({ version: null, cacheable: isMissing });
        }

        resolve({ version: stdout.trim() || null, cacheable: true });
      },
    );
  });
}

/**
 * Installed version string of a CLI, or `null` when the binary is missing. Cached for 10 minutes
 * per resolved path; a failure other than a missing binary is not cached.
 */
export async function getCliVersion({ provider }: { provider: AICliProvider }): Promise<string | null> {
  const binaryPath = getCliBinaryPath({ provider });
  const cached = versionCache.get(binaryPath);

  if (cached && cached.expiresAt > Date.now()) return cached.version;

  const { version, cacheable } = await probeVersion({ binaryPath });

  if (cacheable) versionCache.set(binaryPath, { version, expiresAt: Date.now() + VERSION_CACHE_TTL_MS });

  return version;
}
