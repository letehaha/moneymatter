import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import { CliCredentialSource, runWithCliCredential } from './cli-credential-run';

jest.mock('@js/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const sourceFor = ({ key, credentials }: { key: string; credentials: { current: string } }) => {
  const save = jest.fn<NonNullable<CliCredentialSource['save']>>(async ({ credential }) => {
    credentials.current = credential;

    return { revision: `rev:${credential}` };
  });
  const load = jest.fn(async () => ({ credential: credentials.current, revision: `rev:${credentials.current}` }));

  return { source: { connectionKey: key, load, save } satisfies CliCredentialSource, load, save };
};

describe('runWithCliCredential', () => {
  const savedCap = process.env.AI_CLI_MAX_CONCURRENT_RUNS;

  afterEach(() => {
    if (savedCap === undefined) delete process.env.AI_CLI_MAX_CONCURRENT_RUNS;
    else process.env.AI_CLI_MAX_CONCURRENT_RUNS = savedCap;
  });

  it('loads the credential and hands it to a Claude run', async () => {
    const { source } = sourceFor({ key: 'claude-basic', credentials: { current: 'sk-ant-oat01-token' } });

    const result = await runWithCliCredential({
      provider: AI_PROVIDER.claudeCode,
      source,
      timeoutMs: 1000,
      run: async ({ credential, codexHome }) => ({ credential, codexHome }),
    });

    expect(result).toEqual({ credential: 'sk-ant-oat01-token', codexHome: undefined });
  });

  it('runs several Claude calls on one connection at once and never writes anything back', async () => {
    const { source, load, save } = sourceFor({ key: 'claude-parallel', credentials: { current: 'tok' } });
    const bothRunning = deferred();
    let running = 0;

    const run = async ({ credential }: { credential?: string }) => {
      running += 1;
      if (running === 2) bothRunning.resolve();

      await bothRunning.promise;

      return credential;
    };

    const results = await Promise.all([
      runWithCliCredential({ provider: AI_PROVIDER.claudeCode, source, timeoutMs: 1000, run }),
      runWithCliCredential({ provider: AI_PROVIDER.claudeCode, source, timeoutMs: 1000, run }),
    ]);

    expect(results).toEqual(['tok', 'tok']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('materializes a Codex home with the credential', async () => {
    const { source } = sourceFor({ key: 'codex-basic', credentials: { current: '{"a":1}' } });

    const content = await runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: ({ codexHome }) => readFile(path.join(codexHome!, 'auth.json'), 'utf8'),
    });

    expect(content).toBe('{"a":1}');
  });

  it('runs Codex calls on one connection at once in one shared home and loads the credential once', async () => {
    const credentials = { current: '{"refresh":"one"}' };
    const { source, load, save } = sourceFor({ key: 'codex-shared', credentials });
    const firstRewrote = deferred();
    const secondDone = deferred();
    const homes: (string | undefined)[] = [];
    let seenBySecond = '';

    const first = runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => {
        homes.push(codexHome);
        await writeFile(path.join(codexHome!, 'auth.json'), '{"refresh":"two"}');
        firstRewrote.resolve();
        await secondDone.promise;
      },
    });

    await firstRewrote.promise;

    const second = runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => {
        homes.push(codexHome);
        seenBySecond = await readFile(path.join(codexHome!, 'auth.json'), 'utf8');
        secondDone.resolve();
      },
    });

    await Promise.all([first, second]);

    expect(homes[0]).toBe(homes[1]);
    expect(seenBySecond).toBe('{"refresh":"two"}');
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('loads the credential for a Codex call that starts after the previous ones ended', async () => {
    const credentials = { current: '{"refresh":"one"}' };
    const { source, load } = sourceFor({ key: 'codex-sequential', credentials });
    let seen = '';

    await runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: ({ codexHome }) => writeFile(path.join(codexHome!, 'auth.json'), '{"refresh":"two"}'),
    });
    await runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => {
        seen = await readFile(path.join(codexHome!, 'auth.json'), 'utf8');
      },
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(seen).toBe('{"refresh":"two"}');
  });

  it('passes the loaded revision to save', async () => {
    const { source, save } = sourceFor({ key: 'codex-revision', credentials: { current: '{"v":1}' } });

    await runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}'),
    });

    expect(save).toHaveBeenCalledWith({ credential: '{"v":2}', loadedRevision: 'rev:{"v":1}' });
  });

  it('persists a refresh even when the run then fails', async () => {
    const { source, save } = sourceFor({ key: 'codex-fail', credentials: { current: '{"v":1}' } });

    await expect(
      runWithCliCredential({
        provider: AI_PROVIDER.codex,
        source,
        timeoutMs: 1000,
        run: async ({ codexHome }) => {
          await writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}');
          throw new Error('usage limit');
        },
      }),
    ).rejects.toThrow('usage limit');

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('releases the slot only after save resolved', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const credentials = { current: '{"v":1}' };
    const { source } = sourceFor({ key: 'codex-save-order', credentials });
    const saveGate = deferred();
    const saveStarted = deferred();
    const events: string[] = [];

    source.save.mockImplementation(async ({ credential }) => {
      events.push('save:start');
      saveStarted.resolve();
      await saveGate.promise;
      credentials.current = credential;
      events.push('save:end');

      return { revision: `rev:${credential}` };
    });

    const first = runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}'),
    });
    const second = runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async () => {
        events.push('second:run');
      },
    });

    await saveStarted.promise;
    // One tick for `second` to run if the slot were wrongly free.
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['save:start']);

    saveGate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(['save:start', 'save:end', 'second:run']);
  });

  it('propagates the run error when save also fails', async () => {
    const { source, save } = sourceFor({ key: 'codex-save-fails', credentials: { current: '{"v":1}' } });
    save.mockRejectedValue(new Error('db down'));

    await expect(
      runWithCliCredential({
        provider: AI_PROVIDER.codex,
        source,
        timeoutMs: 1000,
        run: async ({ codexHome }) => {
          await writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}');
          throw new Error('run failed');
        },
      }),
    ).rejects.toThrow('run failed');
  });

  it('runs beforeRelease after save and before the next queued caller loads', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const credentials = { current: '{"v":1}' };
    const { source, load } = sourceFor({ key: 'codex-before-release', credentials });
    const events: string[] = [];

    source.save.mockImplementation(async ({ credential }) => {
      events.push('save');
      credentials.current = credential;

      return { revision: credential };
    });
    load.mockImplementation(async () => {
      events.push('load');

      return { credential: credentials.current, revision: credentials.current };
    });

    const first = runWithCliCredential({
      provider: AI_PROVIDER.codex,
      source,
      timeoutMs: 1000,
      run: async ({ codexHome }) => writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}'),
      beforeRelease: async ({ outcome }) => {
        events.push(`before-release:${outcome.ok ? 'ok' : 'error'}`);
      },
    });
    const second = runWithCliCredential({ provider: AI_PROVIDER.codex, source, timeoutMs: 1000, run: async () => {} });

    await Promise.all([first, second]);

    expect(events).toEqual(['load', 'save', 'before-release:ok', 'load']);
  });

  it('reports a failed run to beforeRelease and fails the call when beforeRelease throws after a success', async () => {
    const { source } = sourceFor({ key: 'claude-before-release', credentials: { current: 'tok' } });
    const outcomes: boolean[] = [];

    await expect(
      runWithCliCredential({
        provider: AI_PROVIDER.claudeCode,
        source,
        timeoutMs: 1000,
        run: async () => {
          throw new Error('nope');
        },
        beforeRelease: async ({ outcome }) => {
          outcomes.push(outcome.ok);
        },
      }),
    ).rejects.toThrow('nope');

    await expect(
      runWithCliCredential({
        provider: AI_PROVIDER.claudeCode,
        source,
        timeoutMs: 1000,
        run: async () => 'fine',
        beforeRelease: async () => {
          throw new Error('consume failed');
        },
      }),
    ).rejects.toThrow('consume failed');

    expect(outcomes).toEqual([false]);
  });

  it('works without a save callback', async () => {
    const source: CliCredentialSource = {
      connectionKey: 'codex-no-save',
      load: async () => ({ credential: '{"v":1}', revision: 'r' }),
    };

    await expect(
      runWithCliCredential({
        provider: AI_PROVIDER.codex,
        source,
        timeoutMs: 1000,
        run: async ({ codexHome }) => writeFile(path.join(codexHome!, 'auth.json'), '{"v":2}'),
      }),
    ).resolves.toBeUndefined();
  });
});
