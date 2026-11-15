import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createSandboxPool, type SandboxPool } from './sandbox-pool';

jest.setTimeout(30_000);

const pools: SandboxPool[] = [];

const makePool = (params: Parameters<typeof createSandboxPool>[0] = {}) => {
  const pool = createSandboxPool(params);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.terminateWorkers()));
});

const OK_CODE = 'return { values: { ok: true } };';
const HANG_CODE = 'while (true) {}';

describe('createSandboxPool', () => {
  it('runs a job and reuses the worker for the next one', async () => {
    const pool = makePool({ size: 1 });

    const first = await pool.run({ code: OK_CODE, inputJson: '{}' });
    const second = await pool.run({ code: OK_CODE, inputJson: '{}' });

    expect(first).toEqual({ ok: true, outputJson: '{"values":{"ok":true}}' });
    expect(second).toEqual(first);
    expect(pool.workerCount()).toBe(1);
  });

  it('starts no worker until the first job', () => {
    expect(makePool().workerCount()).toBe(0);
  });

  it('spawns up to its size and no more', async () => {
    const pool = makePool({ size: 2 });

    const results = await Promise.all(Array.from({ length: 5 }, () => pool.run({ code: OK_CODE, inputJson: '{}' })));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(pool.workerCount()).toBe(2);
  });

  it('queues jobs in order behind a busy worker', async () => {
    const pool = makePool({ size: 1 });
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2].map((index) =>
        pool.run({ code: `return { values: { index: ${index} } };`, inputJson: '{}' }).then(() => order.push(index)),
      ),
    );

    expect(order).toEqual([0, 1, 2]);
  });

  it('refuses a job when too many are waiting', async () => {
    const pool = makePool({ size: 1, maxQueued: 1, limits: { cpuMs: 300, wallMs: 1_000 } });

    const [running, queued, refused] = await Promise.all([
      pool.run({ code: HANG_CODE, inputJson: '{}' }),
      pool.run({ code: OK_CODE, inputJson: '{}' }),
      pool.run({ code: OK_CODE, inputJson: '{}' }),
    ]);

    expect(running).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(queued.ok).toBe(true);
    expect(refused).toMatchObject({ ok: false, error: { kind: 'busy' } });
  });

  it('terminates a worker at the wall clock and replaces it', async () => {
    const pool = makePool({ size: 1, limits: { cpuMs: 60_000, wallMs: 400 } });
    const startedAt = Date.now();

    const stuck = await pool.run({ code: HANG_CODE, inputJson: '{}' });
    const elapsed = Date.now() - startedAt;
    const next = await pool.run({ code: OK_CODE, inputJson: '{}' });

    expect(stuck).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(elapsed).toBeLessThan(3_000);
    expect(next.ok).toBe(true);
  });

  it('fails the job of a terminated worker and serves the next call with a new one', async () => {
    const pool = makePool({ size: 1, limits: { cpuMs: 60_000, wallMs: 60_000 } });
    await pool.run({ code: OK_CODE, inputJson: '{}' });

    const inFlight = pool.run({ code: HANG_CODE, inputJson: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pool.terminateWorkers();
    const failed = await inFlight;
    const next = await pool.run({ code: OK_CODE, inputJson: '{}' });

    expect(failed).toMatchObject({ ok: false, error: { kind: 'crashed' } });
    expect(next.ok).toBe(true);
    expect(pool.workerCount()).toBe(1);
  });

  it('keeps no state between jobs on one worker', async () => {
    const pool = makePool({ size: 1 });
    await pool.run({ code: 'globalThis.leak = 1; return {};', inputJson: '{}' });

    const result = await pool.run({ code: 'return { values: { leak: typeof leak } };', inputJson: '{}' });

    expect(result).toEqual({ ok: true, outputJson: '{"values":{"leak":"undefined"}}' });
  });

  it('survives a memory bomb and a following call', async () => {
    const pool = makePool({ size: 1 });

    const bomb = await pool.run({
      code: 'const a = []; while (true) a.push(new Array(10000).fill(0));',
      inputJson: '{}',
    });
    const next = await pool.run({ code: OK_CODE, inputJson: '{}' });

    expect(bomb).toMatchObject({ ok: false, error: { kind: 'memory' } });
    expect(next.ok).toBe(true);
  });

  it('replaces a worker after it has served many runs', async () => {
    const pool = makePool({ size: 1, maxRunsPerWorker: 2 });

    const results = await Promise.all(Array.from({ length: 5 }, () => pool.run({ code: OK_CODE, inputJson: '{}' })));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(pool.workerCount()).toBeLessThanOrEqual(1);
  });
});
