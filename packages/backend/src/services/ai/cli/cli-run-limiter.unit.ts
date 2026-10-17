import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { abortAllCliRuns, CliSlotBusyError, getFeatureRunTimeoutMs, runWithCliSlot } from './cli-run-limiter';

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

  it('serializes runs that share a connection key', async () => {
    const order: string[] = [];
    const first = deferred();

    const a = runWithCliSlot({
      connectionKey: 'serial',
      timeoutMs: 1000,
      run: async () => {
        order.push('a:start');
        await first.promise;
        order.push('a:end');
      },
    });
    const b = runWithCliSlot({
      connectionKey: 'serial',
      timeoutMs: 1000,
      run: async () => {
        order.push('b:start');
      },
    });

    await flush();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
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
