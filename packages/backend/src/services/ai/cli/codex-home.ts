import { logger } from '@js/utils/logger';
import { createHash } from 'crypto';
import { readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import { createPrivateDir } from './cli-workdir';

const AUTH_FILE = 'auth.json';

const sha256 = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

type SaveCredential = (params: { credential: string; loadedRevision: string }) => Promise<{ revision: string } | null>;

/** The one `CODEX_HOME` the concurrent runs of a connection share, and what is needed to write it back. */
interface SharedHome {
  dir: string;
  authPath: string;
  refs: number;
  /** The stored ciphertext the next write-back is compared against; advances with every successful save. */
  revision: string;
  /** Hash of the last `auth.json` content that is stored (or deliberately not stored), so it is saved once. */
  settledHash: string;
  save: SaveCredential | undefined;
  /** Set once the stored credential moved on without this home: no new run joins it and it is not written back. */
  retired: boolean;
}

const homes = new Map<string, SharedHome>();
const locks = new Map<string, Promise<unknown>>();

/**
 * In-process mutex per connection. It makes materialize, write-back and removal atomic with respect to
 * each other, so a run that arrives while the last one is saving and deleting waits and then starts
 * from what was saved. It does not span processes: a second backend process keeps its own home.
 */
async function withConnectionLock<T>({ key, run }: { key: string; run: () => Promise<T> }): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );

  locks.set(key, tail);

  try {
    return await result;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

async function createSharedHome({
  key,
  loaded: { credential, revision },
  save,
}: {
  key: string;
  loaded: { credential: string; revision: string };
  save: SaveCredential | undefined;
}): Promise<SharedHome> {
  const dir = await createPrivateDir({ prefix: 'mm-codex-home' });
  const authPath = path.join(dir, AUTH_FILE);

  try {
    await writeFile(authPath, credential, { mode: 0o600 });
    await writeFile(path.join(dir, 'config.toml'), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  const home: SharedHome = {
    dir,
    authPath,
    refs: 0,
    revision,
    settledHash: sha256({ content: credential }),
    save,
    retired: false,
  };

  homes.set(key, home);

  return home;
}

/**
 * Saves `auth.json` when Codex rewrote it since the last save. A failed save is logged and retried by
 * the next run to end; a skipped swap (the stored credential changed meanwhile) is final, the stored
 * one wins. It never throws: a run's own outcome must not depend on the write-back.
 */
async function persistIfChanged({ key, home }: { key: string; home: SharedHome }): Promise<void> {
  let content: string;

  try {
    content = await readFile(home.authPath, 'utf8');
  } catch {
    return;
  }

  const hash = sha256({ content });

  if (hash === home.settledHash) return;

  try {
    JSON.parse(content);
  } catch {
    logger.warn('Codex rewrote auth.json into something that is not JSON, keeping the stored credential');

    return;
  }

  if (!home.save) {
    home.settledHash = hash;

    return;
  }

  try {
    const saved = await home.save({ credential: content, loadedRevision: home.revision });

    home.settledHash = hash;
    if (saved) home.revision = saved.revision;
  } catch (error) {
    logger.error('Failed to persist a refreshed CLI credential', {
      connectionKey: key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Takes the home out of circulation: its current runs finish on it, nothing new joins, nothing is saved. */
function retireHome({ key, home }: { key: string; home: SharedHome }) {
  home.retired = true;

  if (homes.get(key) === home) homes.delete(key);
}

async function acquireHome({
  key,
  load,
  save,
}: {
  key: string;
  load: () => Promise<{ credential: string; revision: string }>;
  save: SaveCredential | undefined;
}): Promise<SharedHome> {
  return withConnectionLock({
    key,
    run: async () => {
      // Every arrival reads the stored credential, so a home that no longer matches it (a re-sign-in
      // replaced the credential) is retired instead of being joined. A home whose own save failed
      // still matches the stored revision and keeps being shared.
      const loaded = await load();
      const existing = homes.get(key);

      if (existing && existing.revision !== loaded.revision) retireHome({ key, home: existing });

      const home = homes.get(key) ?? (await createSharedHome({ key, loaded, save }));

      home.refs += 1;

      return home;
    },
  });
}

/**
 * Retires the connection's shared home, if any, so the next run starts from the stored credential.
 * Disconnecting uses it: the home's remaining runs finish on it and are not written back.
 */
export function retireCodexHome({ connectionKey }: { connectionKey: string }): Promise<void> {
  return withConnectionLock({
    key: connectionKey,
    run: async () => {
      const home = homes.get(connectionKey);

      if (home) retireHome({ key: connectionKey, home });
    },
  });
}

function releaseHome({ key, home }: { key: string; home: SharedHome }): Promise<void> {
  return withConnectionLock({
    key,
    run: async () => {
      if (!home.retired) await persistIfChanged({ key, home });

      home.refs -= 1;

      if (home.refs > 0) return;

      if (homes.get(key) === home) homes.delete(key);

      try {
        await rm(home.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        logger.warn('Could not remove a Codex home directory', {
          connectionKey: key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

/**
 * Runs `run` against the connection's shared `CODEX_HOME`, the way `codex` sessions on a laptop share
 * `~/.codex`. Codex rotates its refresh token, so parallel runs on separate copies would race and the
 * loser would be signed out; on one `auth.json` a refresh by one run is what the others read.
 *
 * The first run materializes `auth.json` from `load` (the stored credential) into a private 0700
 * directory; later runs reuse it while the stored credential is still the one it was built from (a
 * re-sign-in retires it and the next run gets a fresh home, the old runs finishing on theirs without
 * a write-back); the last run of a home removes it. Every run that ends saves a changed
 * `auth.json` first (also when it failed: a refresh followed by a rate limit is still a refresh), as
 * a compare-and-swap through `save`, so a refresh survives the process dying while others still run.
 * Only the home is shared; callers keep their own working directories.
 *
 * The state is per process. A second backend process would materialize its own copy of the same
 * stored credential and the two could race on a rotating refresh token; the compare-and-swap keeps
 * the stored credential consistent, but the losing process's runs can fail until the next sign-in.
 */
export async function withCodexHome<T>({
  connectionKey,
  load,
  save,
  run,
}: {
  connectionKey: string;
  load: () => Promise<{ credential: string; revision: string }>;
  save?: SaveCredential;
  run: (params: { codexHome: string }) => Promise<T>;
}): Promise<T> {
  const home = await acquireHome({ key: connectionKey, load, save });

  try {
    return await run({ codexHome: home.dir });
  } finally {
    await releaseHome({ key: connectionKey, home });
  }
}
