import { describe, expect, it, jest } from '@jest/globals';
import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

import { withCodexHome } from './codex-home';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

type Save = (params: { credential: string; loadedRevision: string }) => Promise<{ revision: string } | null>;

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const authFile = ({ codexHome }: { codexHome: string }) => path.join(codexHome, 'auth.json');

const rewrite = ({ codexHome, content }: { codexHome: string; content: string }) =>
  writeFile(authFile({ codexHome }), content);

const exists = async ({ target }: { target: string }) =>
  stat(target).then(
    () => true,
    () => false,
  );

/** An in-memory stand-in for the encrypted DB copy; `save` is the compare-and-swap. */
function createStore({ initial }: { initial: string }) {
  const state = { credential: initial, revision: 'rev-0', counter: 0 };

  const load = jest.fn(async () => ({ credential: state.credential, revision: state.revision }));
  const save = jest.fn<Save>(async ({ credential, loadedRevision }) => {
    if (loadedRevision !== state.revision) return null;

    state.counter += 1;
    state.credential = credential;
    state.revision = `rev-${state.counter}`;

    return { revision: state.revision };
  });

  return { state, load, save };
}

describe('withCodexHome', () => {
  it('writes auth.json and config.toml with private modes and removes the dir', async () => {
    const store = createStore({ initial: '{"v":1}' });
    let home = '';

    await withCodexHome({
      connectionKey: 'modes',
      ...store,
      run: async ({ codexHome }) => {
        home = codexHome;

        expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
        expect((await stat(authFile({ codexHome }))).mode & 0o777).toBe(0o600);
        expect((await stat(path.join(codexHome, 'config.toml'))).mode & 0o777).toBe(0o600);
        expect(await readFile(authFile({ codexHome }), 'utf8')).toBe('{"v":1}');
        expect(await readFile(path.join(codexHome, 'config.toml'), 'utf8')).toContain(
          'cli_auth_credentials_store = "file"',
        );
      },
    });

    expect(await exists({ target: home })).toBe(false);
  });

  it('does not call save when auth.json is untouched', async () => {
    const store = createStore({ initial: '{"v":1}' });

    await withCodexHome({ connectionKey: 'untouched', ...store, run: async () => 'ok' });

    expect(store.save).not.toHaveBeenCalled();
  });

  describe('sharing one home per connection', () => {
    it('gives overlapping runs of one connection the same directory and loads the credential once', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const bothRunning = deferred();
      const homes: string[] = [];

      const run = ({ codexHome }: { codexHome: string }) => {
        homes.push(codexHome);

        if (homes.length === 2) bothRunning.resolve();

        return bothRunning.promise;
      };

      await Promise.all([
        withCodexHome({ connectionKey: 'shared', ...store, run }),
        withCodexHome({ connectionKey: 'shared', ...store, run }),
      ]);

      expect(homes[0]).toBe(homes[1]);
      expect(store.load).toHaveBeenCalledTimes(1);
    });

    it('gives different connections different directories', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const bothRunning = deferred();
      const homes: string[] = [];

      const run = ({ codexHome }: { codexHome: string }) => {
        homes.push(codexHome);

        if (homes.length === 2) bothRunning.resolve();

        return bothRunning.promise;
      };

      await Promise.all([
        withCodexHome({ connectionKey: 'conn-a', ...store, run }),
        withCodexHome({ connectionKey: 'conn-b', ...store, run }),
      ]);

      expect(homes[0]).not.toBe(homes[1]);
      expect(store.load).toHaveBeenCalledTimes(2);
    });

    it('shows a run the auth.json another run rewrote, without reloading from the store', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const firstRunning = deferred();
      const release = deferred();
      let seenBySecond = '';

      const first = withCodexHome({
        connectionKey: 'visible',
        ...store,
        run: async ({ codexHome }) => {
          await rewrite({ codexHome, content: '{"v":2}' });
          firstRunning.resolve();
          await release.promise;
        },
      });

      await firstRunning.promise;

      await withCodexHome({
        connectionKey: 'visible',
        ...store,
        run: async ({ codexHome }) => {
          seenBySecond = await readFile(authFile({ codexHome }), 'utf8');
        },
      });

      release.resolve();
      await first;

      expect(seenBySecond).toBe('{"v":2}');
      expect(store.load).toHaveBeenCalledTimes(1);
    });

    it('keeps the directory until the last run ends', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const firstUp = deferred();
      const releaseFirst = deferred();
      let home = '';

      const first = withCodexHome({
        connectionKey: 'refcount',
        ...store,
        run: async ({ codexHome }) => {
          home = codexHome;
          firstUp.resolve();
          await releaseFirst.promise;
        },
      });

      await firstUp.promise;
      await withCodexHome({ connectionKey: 'refcount', ...store, run: async () => {} });

      expect(await exists({ target: authFile({ codexHome: home }) })).toBe(true);

      releaseFirst.resolve();
      await first;

      expect(await exists({ target: home })).toBe(false);
    });

    it('materializes a fresh home from the store for a run that arrives after the last one ended', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const homes: string[] = [];

      await withCodexHome({
        connectionKey: 'fresh',
        ...store,
        run: async ({ codexHome }) => {
          homes.push(codexHome);
          await rewrite({ codexHome, content: '{"v":2}' });
        },
      });

      let seen = '';

      await withCodexHome({
        connectionKey: 'fresh',
        ...store,
        run: async ({ codexHome }) => {
          homes.push(codexHome);
          seen = await readFile(authFile({ codexHome }), 'utf8');
        },
      });

      expect(store.load).toHaveBeenCalledTimes(2);
      expect(seen).toBe('{"v":2}');
      expect(await exists({ target: homes[1]! })).toBe(false);
    });

    it('makes an arrival wait for the write-back and removal of the home that is ending', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const saveStarted = deferred();
      const saveGate = deferred();
      const events: string[] = [];

      store.save.mockImplementation(async ({ credential }) => {
        events.push('save:start');
        saveStarted.resolve();
        await saveGate.promise;
        store.state.credential = credential;
        store.state.revision = 'rev-saved';
        events.push('save:end');

        return { revision: 'rev-saved' };
      });
      store.load.mockImplementation(async () => {
        events.push('load');

        return { credential: store.state.credential, revision: store.state.revision };
      });

      const first = withCodexHome({
        connectionKey: 'arrival',
        ...store,
        run: async ({ codexHome }) => rewrite({ codexHome, content: '{"v":2}' }),
      });

      await saveStarted.promise;

      let seen = '';
      const second = withCodexHome({
        connectionKey: 'arrival',
        ...store,
        run: async ({ codexHome }) => {
          seen = await readFile(authFile({ codexHome }), 'utf8');
        },
      });

      await tick();
      await tick();
      expect(events).toEqual(['load', 'save:start']);

      saveGate.resolve();
      await Promise.all([first, second]);

      expect(events).toEqual(['load', 'save:start', 'save:end', 'load']);
      expect(seen).toBe('{"v":2}');
    });

    it('lets two arrivals at the same moment share one materialization', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const loadGate = deferred();

      store.load.mockImplementation(async () => {
        await loadGate.promise;

        return { credential: store.state.credential, revision: store.state.revision };
      });

      const homes: string[] = [];
      const run = async ({ codexHome }: { codexHome: string }) => {
        homes.push(codexHome);
      };

      const both = Promise.all([
        withCodexHome({ connectionKey: 'simultaneous', ...store, run }),
        withCodexHome({ connectionKey: 'simultaneous', ...store, run }),
      ]);

      await tick();
      loadGate.resolve();
      await both;

      expect(store.load).toHaveBeenCalledTimes(1);
      expect(homes[0]).toBe(homes[1]);
    });
  });

  describe('writing a refresh back', () => {
    it('saves the rewritten file against the revision it was loaded from', async () => {
      const store = createStore({ initial: '{"v":1}' });

      const result = await withCodexHome({
        connectionKey: 'write-back',
        ...store,
        run: async ({ codexHome }) => {
          await rewrite({ codexHome, content: '{"v":2}' });

          return 'ok';
        },
      });

      expect(result).toBe('ok');
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalledWith({ credential: '{"v":2}', loadedRevision: 'rev-0' });
      expect(store.state.credential).toBe('{"v":2}');
    });

    it('saves a refresh when the run that saw it ends, even though another run is still active', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const longRunUp = deferred();
      const releaseLongRun = deferred();

      const longRun = withCodexHome({
        connectionKey: 'early-persist',
        ...store,
        run: async () => {
          longRunUp.resolve();
          await releaseLongRun.promise;
        },
      });

      await longRunUp.promise;
      await withCodexHome({
        connectionKey: 'early-persist',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{"v":2}' }),
      });

      expect(store.state.credential).toBe('{"v":2}');

      releaseLongRun.resolve();
      await longRun;

      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('chains successive saves on the revision the previous save returned', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const anchorUp = deferred();
      const releaseAnchor = deferred();

      const anchor = withCodexHome({
        connectionKey: 'chain',
        ...store,
        run: async () => {
          anchorUp.resolve();
          await releaseAnchor.promise;
        },
      });

      await anchorUp.promise;

      await withCodexHome({
        connectionKey: 'chain',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{"v":2}' }),
      });
      await withCodexHome({
        connectionKey: 'chain',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{"v":3}' }),
      });

      releaseAnchor.resolve();
      await anchor;

      expect(store.save.mock.calls.map(([params]) => params)).toEqual([
        { credential: '{"v":2}', loadedRevision: 'rev-0' },
        { credential: '{"v":3}', loadedRevision: 'rev-1' },
      ]);
      expect(store.state.credential).toBe('{"v":3}');
    });

    it('does not save the same content twice when several runs end on an unchanged refresh', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const bothUp = deferred();
      const secondEnded = deferred();
      let started = 0;

      const run = async ({ codexHome }: { codexHome: string }, isFirst: boolean) => {
        started += 1;
        if (started === 2) bothUp.resolve();
        await bothUp.promise;

        if (isFirst) {
          await rewrite({ codexHome, content: '{"v":2}' });
          await secondEnded.promise;
        }
      };

      const first = withCodexHome({ connectionKey: 'dedupe', ...store, run: (params) => run(params, true) });
      const second = withCodexHome({ connectionKey: 'dedupe', ...store, run: (params) => run(params, false) });

      await second;
      secondEnded.resolve();
      await first;

      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('saves the refresh and rethrows the run error when the run fails after rewriting auth.json', async () => {
      const store = createStore({ initial: '{"v":1}' });
      let home = '';

      await expect(
        withCodexHome({
          connectionKey: 'run-fails',
          ...store,
          run: async ({ codexHome }) => {
            home = codexHome;
            await rewrite({ codexHome, content: '{"v":2}' });
            throw new Error('rate limited');
          },
        }),
      ).rejects.toThrow('rate limited');

      expect(store.state.credential).toBe('{"v":2}');
      expect(await exists({ target: home })).toBe(false);
    });

    it('ignores a rewrite that is not JSON', async () => {
      const store = createStore({ initial: '{"v":1}' });

      await withCodexHome({
        connectionKey: 'not-json',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{not json' }),
      });

      expect(store.save).not.toHaveBeenCalled();
    });

    it('saves nothing when the file is gone, as after codex logout', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const { rm } = await import('fs/promises');

      await withCodexHome({
        connectionKey: 'logged-out',
        ...store,
        run: ({ codexHome }) => rm(authFile({ codexHome })),
      });

      expect(store.save).not.toHaveBeenCalled();
    });

    it('does not fail the run when the store skips the swap, and does not retry the same content', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const anchorUp = deferred();
      const releaseAnchor = deferred();

      store.save.mockResolvedValue(null);

      const anchor = withCodexHome({
        connectionKey: 'swap-skipped',
        ...store,
        run: async () => {
          anchorUp.resolve();
          await releaseAnchor.promise;
        },
      });

      await anchorUp.promise;
      await withCodexHome({
        connectionKey: 'swap-skipped',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{"v":2}' }),
      });
      releaseAnchor.resolve();
      await anchor;

      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('lets the run result and run error win over a save failure, and still removes the directory', async () => {
      const store = createStore({ initial: '{"v":1}' });
      let home = '';

      store.save.mockRejectedValue(new Error('db down'));

      await expect(
        withCodexHome({
          connectionKey: 'save-fails',
          ...store,
          run: async ({ codexHome }) => {
            home = codexHome;
            await rewrite({ codexHome, content: '{"v":2}' });

            return 'fine';
          },
        }),
      ).resolves.toBe('fine');

      await expect(
        withCodexHome({
          connectionKey: 'save-fails',
          ...store,
          run: async ({ codexHome }) => {
            await rewrite({ codexHome, content: '{"v":3}' });
            throw new Error('run failed');
          },
        }),
      ).rejects.toThrow('run failed');

      expect(await exists({ target: home })).toBe(false);
    });

    it('retries a failed save when a later run of the same home ends', async () => {
      const store = createStore({ initial: '{"v":1}' });
      const anchorUp = deferred();
      const releaseAnchor = deferred();

      store.save.mockRejectedValueOnce(new Error('db blip'));

      const anchor = withCodexHome({
        connectionKey: 'retry',
        ...store,
        run: async () => {
          anchorUp.resolve();
          await releaseAnchor.promise;
        },
      });

      await anchorUp.promise;
      await withCodexHome({
        connectionKey: 'retry',
        ...store,
        run: ({ codexHome }) => rewrite({ codexHome, content: '{"v":2}' }),
      });

      expect(store.state.credential).toBe('{"v":1}');

      releaseAnchor.resolve();
      await anchor;

      expect(store.state.credential).toBe('{"v":2}');
    });

    it('works without a save callback', async () => {
      await expect(
        withCodexHome({
          connectionKey: 'no-save',
          load: async () => ({ credential: '{"v":1}', revision: 'r' }),
          run: async ({ codexHome }) => {
            await rewrite({ codexHome, content: '{"v":2}' });

            return 'ok';
          },
        }),
      ).resolves.toBe('ok');
    });
  });

  describe('when the credential cannot be loaded', () => {
    it('rejects, leaves no home behind and lets the next run try again', async () => {
      const store = createStore({ initial: '{"v":1}' });

      store.load.mockRejectedValueOnce(new Error('unreadable'));

      await expect(withCodexHome({ connectionKey: 'load-fails', ...store, run: async () => 'never' })).rejects.toThrow(
        'unreadable',
      );

      await expect(withCodexHome({ connectionKey: 'load-fails', ...store, run: async () => 'ok' })).resolves.toBe('ok');
    });
  });
});
