import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  abortAllCliRuns,
  abortCliRunsForConnection,
  CliSlotBusyError,
  getFeatureRunTimeoutMs,
  runWithCliSlot,
} from './cli-run-limiter';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const untilAborted = ({ signal }: { signal: AbortSignal }) =>
  new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));

const flush = () => jest.advanceTimersByTimeAsync(0);

describe('runWithCliSlot', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const key of ['AI_CLI_MAX_CONCURRENT_RUNS', 'AI_CLI_RUN_TIMEOUT_MS']) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('runs calls that share a connection key in parallel', async () => {
    const gates = [deferred(), deferred()];
    const started: number[] = [];

    const runs = gates.map((gate, index) =>
      runWithCliSlot({
        connectionKey: 'shared-key',
        timeoutMs: 1000,
        run: async () => {
          started.push(index);
          await gate.promise;
        },
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    for (const gate of gates) gate.resolve();
    await Promise.all(runs);
  });

  it('caps concurrent runs instance-wide', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '2';
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const runs = gates.map((gate, index) =>
      runWithCliSlot({
        connectionKey: `cap-${index}`,
        timeoutMs: 1000,
        run: async () => {
          started.push(index);
          await gate.promise;
        },
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[0]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(runs);
  });

  it('allows four simultaneous runs by default, whatever their connection', async () => {
    delete process.env.AI_CLI_MAX_CONCURRENT_RUNS;
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];

    const runs = gates.map((gate, index) =>
      runWithCliSlot({
        connectionKey: index < 3 ? 'same' : `other-${index}`,
        timeoutMs: 1000,
        run: async () => {
          started.push(index);
          await gate.promise;
        },
      }),
    );

    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[0]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    for (const gate of gates) gate.resolve();
    await Promise.all(runs);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])(
    'falls back to four runs when AI_CLI_MAX_CONCURRENT_RUNS is %j',
    async (raw) => {
      process.env.AI_CLI_MAX_CONCURRENT_RUNS = raw;
      const gates = Array.from({ length: 5 }, () => deferred());
      const started: number[] = [];

      const runs = gates.map((gate, index) =>
        runWithCliSlot({
          connectionKey: `fallback-${index}`,
          timeoutMs: 1000,
          run: async () => {
            started.push(index);
            await gate.promise;
          },
        }),
      );

      await flush();
      expect(started).toHaveLength(4);

      for (const gate of gates) gate.resolve();
      await Promise.all(runs);
    },
  );

  it('releases the slot when run throws', async () => {
    await expect(
      runWithCliSlot({
        connectionKey: 'throws',
        timeoutMs: 1000,
        run: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    await expect(runWithCliSlot({ connectionKey: 'throws', timeoutMs: 1000, run: async () => 'next' })).resolves.toBe(
      'next',
    );
  });

  it('drops an aborted waiter from the queue without running it', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const first = deferred();
    const controller = new AbortController();
    const waiterRan = jest.fn();

    const a = runWithCliSlot({ connectionKey: 'abort', timeoutMs: 1000, run: () => first.promise });
    const waiting = runWithCliSlot({
      connectionKey: 'abort',
      abortSignal: controller.signal,
      timeoutMs: 1000,
      run: async () => waiterRan(),
    });
    const waitingResult = waiting.catch((error: unknown) => error);

    await flush();
    controller.abort(new Error('caller gave up'));

    expect(await waitingResult).toEqual(new Error('caller gave up'));

    first.resolve();
    await a;

    await expect(runWithCliSlot({ connectionKey: 'abort', timeoutMs: 1000, run: async () => 'free' })).resolves.toBe(
      'free',
    );
    expect(waiterRan).not.toHaveBeenCalled();
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));

    await expect(
      runWithCliSlot({
        connectionKey: 'pre-aborted',
        abortSignal: controller.signal,
        timeoutMs: 1000,
        run: async () => 1,
      }),
    ).rejects.toThrow('already aborted');
  });

  it('propagates a caller abort to a running call', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;

    const running = runWithCliSlot({
      connectionKey: 'abort-running',
      abortSignal: controller.signal,
      timeoutMs: 1000,
      run: async ({ signal }) => {
        seen = signal;
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
      },
    });

    await flush();
    controller.abort();
    await running;

    expect(seen?.aborted).toBe(true);
  });

  it('gives a run its full timeout even after it queued longer than that', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const first = deferred();
    let secondSignal: AbortSignal | undefined;

    const a = runWithCliSlot({ connectionKey: 'queue-time', timeoutMs: 1000, run: () => first.promise });
    const b = runWithCliSlot({
      connectionKey: 'queue-time',
      timeoutMs: 1000,
      run: async ({ signal }) => {
        secondSignal = signal;
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
      },
    });

    await jest.advanceTimersByTimeAsync(5000);
    first.resolve();
    await a;
    await flush();

    expect(secondSignal).toBeDefined();
    expect(secondSignal!.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(999);
    expect(secondSignal!.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(secondSignal!.aborted).toBe(true);
    expect((secondSignal!.reason as DOMException).name).toBe('TimeoutError');
    await b;
  });

  it('gives up with CliSlotBusyError once maxWaitMs passes without a slot', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const first = deferred();
    const a = runWithCliSlot({ connectionKey: 'busy', timeoutMs: 100_000, run: () => first.promise });
    const probe = runWithCliSlot({ connectionKey: 'busy', timeoutMs: 1000, maxWaitMs: 2000, run: async () => 'ran' });
    const probeResult = probe.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(2000);

    expect(await probeResult).toBeInstanceOf(CliSlotBusyError);

    first.resolve();
    await a;
    await expect(runWithCliSlot({ connectionKey: 'busy', timeoutMs: 1000, run: async () => 'free' })).resolves.toBe(
      'free',
    );
  });

  it('does not report busy when the slot arrives before maxWaitMs', async () => {
    process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
    const first = deferred();
    const a = runWithCliSlot({ connectionKey: 'not-busy', timeoutMs: 100_000, run: () => first.promise });
    const probe = runWithCliSlot({
      connectionKey: 'not-busy',
      timeoutMs: 1000,
      maxWaitMs: 2000,
      run: async () => 'ran',
    });

    await jest.advanceTimersByTimeAsync(1000);
    first.resolve();
    await a;

    await expect(probe).resolves.toBe('ran');
  });

  describe('abortAllCliRuns', () => {
    it('aborts running and queued calls and resolves once their cleanup finished', async () => {
      process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
      const events: string[] = [];
      const waiterRan = jest.fn();

      const running = runWithCliSlot({
        connectionKey: 'abort-all',
        timeoutMs: 100_000,
        run: async ({ signal }) => {
          await untilAborted({ signal });
          events.push('cleanup:start');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          events.push('cleanup:end');
        },
      });
      const queued = runWithCliSlot({ connectionKey: 'abort-all', timeoutMs: 100_000, run: async () => waiterRan() });
      const queuedResult = queued.catch((error: unknown) => error);

      await flush();

      const aborting = abortAllCliRuns().then(() => events.push('abort-all:done'));

      await jest.advanceTimersByTimeAsync(1000);
      await aborting;
      await running;

      expect(events).toEqual(['cleanup:start', 'cleanup:end', 'abort-all:done']);
      expect(await queuedResult).toMatchObject({ name: 'AbortError' });
      expect(waiterRan).not.toHaveBeenCalled();
    });

    it('frees the slots, so a later call runs', async () => {
      const running = runWithCliSlot({
        connectionKey: 'abort-all-free',
        timeoutMs: 100_000,
        run: ({ signal }) => untilAborted({ signal }),
      });

      await flush();
      await abortAllCliRuns();
      await running;

      await expect(
        runWithCliSlot({ connectionKey: 'abort-all-free', timeoutMs: 1000, run: async () => 'free' }),
      ).resolves.toBe('free');
    });

    it('gives up waiting after three seconds when a run does not settle', async () => {
      const stuck = deferred();

      const running = runWithCliSlot({
        connectionKey: 'abort-all-stuck',
        timeoutMs: 100_000,
        run: () => stuck.promise,
      });
      let done = false;

      await flush();

      const aborting = abortAllCliRuns().then(() => {
        done = true;
      });

      await jest.advanceTimersByTimeAsync(2999);
      expect(done).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await aborting;
      expect(done).toBe(true);

      stuck.resolve();
      await running;
    });

    it('resolves immediately when nothing is running', async () => {
      await expect(abortAllCliRuns()).resolves.toBeUndefined();
    });

    it('does not track a finished call', async () => {
      await runWithCliSlot({ connectionKey: 'abort-all-finished', timeoutMs: 1000, run: async () => 'done' });

      await expect(abortAllCliRuns()).resolves.toBeUndefined();
    });
  });

  describe('abortCliRunsForConnection', () => {
    it('aborts every running and queued call of that connection and waits for their cleanup', async () => {
      process.env.AI_CLI_MAX_CONCURRENT_RUNS = '1';
      const events: string[] = [];

      const running = runWithCliSlot({
        connectionKey: 'abort-conn',
        timeoutMs: 100_000,
        run: async ({ signal }) => {
          await untilAborted({ signal });
          events.push('cleanup:start');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          events.push('cleanup:end');
        },
      });
      const queued = runWithCliSlot({ connectionKey: 'abort-conn', timeoutMs: 100_000, run: async () => 'never' });
      const queuedResult = queued.catch((error: unknown) => error);

      await flush();

      const aborting = abortCliRunsForConnection({ connectionKey: 'abort-conn' }).then(() => events.push('abort:done'));

      await jest.advanceTimersByTimeAsync(1000);
      await aborting;
      await running;

      expect(events).toEqual(['cleanup:start', 'cleanup:end', 'abort:done']);
      expect(await queuedResult).toMatchObject({ name: 'AbortError' });
    });

    it('leaves the runs of other connections alone', async () => {
      const other = deferred();
      const mine = runWithCliSlot({
        connectionKey: 'abort-mine',
        timeoutMs: 100_000,
        run: ({ signal }) => untilAborted({ signal }),
      });
      let otherSignal: AbortSignal | undefined;
      const otherRun = runWithCliSlot({
        connectionKey: 'abort-other',
        timeoutMs: 100_000,
        run: async ({ signal }) => {
          otherSignal = signal;
          await other.promise;

          return 'other done';
        },
      });

      await flush();
      await abortCliRunsForConnection({ connectionKey: 'abort-mine' });
      await mine;

      expect(otherSignal!.aborted).toBe(false);

      other.resolve();
      await expect(otherRun).resolves.toBe('other done');
    });

    it('lets a later call of the same connection run', async () => {
      const running = runWithCliSlot({
        connectionKey: 'abort-conn-later',
        timeoutMs: 100_000,
        run: ({ signal }) => untilAborted({ signal }),
      });

      await flush();
      await abortCliRunsForConnection({ connectionKey: 'abort-conn-later' });
      await running;

      await expect(
        runWithCliSlot({ connectionKey: 'abort-conn-later', timeoutMs: 1000, run: async () => 'free' }),
      ).resolves.toBe('free');
    });

    it('gives up waiting after three seconds when a run does not settle', async () => {
      const stuck = deferred();
      const running = runWithCliSlot({
        connectionKey: 'abort-conn-stuck',
        timeoutMs: 100_000,
        run: () => stuck.promise,
      });
      let done = false;

      await flush();

      const aborting = abortCliRunsForConnection({ connectionKey: 'abort-conn-stuck' }).then(() => {
        done = true;
      });

      await jest.advanceTimersByTimeAsync(2999);
      expect(done).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await aborting;
      expect(done).toBe(true);

      stuck.resolve();
      await running;
    });

    it('resolves immediately when the connection has no calls', async () => {
      await expect(abortCliRunsForConnection({ connectionKey: 'abort-conn-none' })).resolves.toBeUndefined();
    });
  });

  describe('getFeatureRunTimeoutMs', () => {
    it('defaults to five minutes', () => {
      delete process.env.AI_CLI_RUN_TIMEOUT_MS;
      expect(getFeatureRunTimeoutMs()).toBe(5 * 60 * 1000);
    });

    it('honors AI_CLI_RUN_TIMEOUT_MS under NODE_ENV=test only', () => {
      process.env.AI_CLI_RUN_TIMEOUT_MS = '250';
      expect(getFeatureRunTimeoutMs()).toBe(250);

      process.env.NODE_ENV = 'production';
      try {
        expect(getFeatureRunTimeoutMs()).toBe(5 * 60 * 1000);
      } finally {
        process.env.NODE_ENV = 'test';
      }
    });
  });
});
