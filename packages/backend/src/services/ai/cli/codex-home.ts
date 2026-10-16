import { logger } from '@js/utils/logger';
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import { withTempDir } from './cli-workdir';

const AUTH_FILE = 'auth.json';

const sha256 = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

async function readRefreshedAuth({ authPath, loadedHash }: { authPath: string; loadedHash: string }) {
  let content: string;

  try {
    content = await readFile(authPath, 'utf8');
  } catch {
    return null;
  }

  if (sha256({ content }) === loadedHash) return null;

  try {
    JSON.parse(content);
  } catch {
    logger.warn('Codex rewrote auth.json into something that is not JSON, keeping the stored credential');

    return null;
  }

  return content;
}

/**
 * Materializes a stored Codex `auth.json` into a private `CODEX_HOME` for one run. Codex refreshes
 * its tokens while it works and rewrites the file, so afterwards (also when `run` threw: a refresh
 * followed by a rate limit or a kill is still a refresh) a changed file is handed to `onRefreshed`
 * before the directory is removed. The run's own error takes precedence over a write-back failure.
 */
export async function withCodexHome<T>({
  authJson,
  onRefreshed,
  run,
}: {
  authJson: string;
  onRefreshed: (params: { authJson: string }) => Promise<void>;
  run: (params: { codexHome: string }) => Promise<T>;
}): Promise<T> {
  return withTempDir({
    prefix: 'mm-codex-home',
    run: async ({ dir }) => {
      const authPath = path.join(dir, AUTH_FILE);

      await writeFile(authPath, authJson, { mode: 0o600 });
      await writeFile(path.join(dir, 'config.toml'), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });

      const loadedHash = sha256({ content: authJson });
      let outcome: { ok: true; value: T } | { ok: false; error: unknown };

      try {
        outcome = { ok: true, value: await run({ codexHome: dir }) };
      } catch (error) {
        outcome = { ok: false, error };
      }

      try {
        const refreshed = await readRefreshedAuth({ authPath, loadedHash });

        if (refreshed !== null) await onRefreshed({ authJson: refreshed });
      } catch (error) {
        if (outcome.ok) throw error;
      }

      if (!outcome.ok) throw outcome.error;

      return outcome.value;
    },
  });
}
