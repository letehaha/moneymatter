import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictError, NotFoundError } from '@js/errors';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExpiringUploadCache } from './expiring-upload-cache';

const MISSING_MESSAGE = 'It is gone. Start again.';

const namespaces: string[] = [];

/** Every cache gets its own temp directory so a leftover entry from one test —
 *  or from a concurrently running suite — can never be seen by another. */
const makeCache = ({ idleTtlMs, maxLifetimeMs }: { idleTtlMs: number; maxLifetimeMs: number }) => {
  const namespace = `budget-tracker-expiring-upload-cache-test-${randomUUID()}`;
  namespaces.push(namespace);

  return {
    namespace,
    directory: join(tmpdir(), namespace),
    cache: createExpiringUploadCache<{ label: string }>({
      namespace,
      idleTtlMs,
      maxLifetimeMs,
      missingMessage: MISSING_MESSAGE,
    }),
  };
};

// Time passes by moving the clock the cache reads, never by sleeping: a slow runner cannot age an entry
// past a window the test meant to stay inside, and no test waits in real time.
const realNow = Date.now;
let elapsedMs = 0;

const advanceClock = ({ ms }: { ms: number }) => {
  elapsedMs += ms;
};

beforeEach(() => {
  elapsedMs = 0;
  const startMs = realNow();
  jest.spyOn(Date, 'now').mockImplementation(() => startMs + elapsedMs);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const msUntil = ({ iso }: { iso: string }) => new Date(iso).getTime() - Date.now();

afterAll(async () => {
  await Promise.all(namespaces.map((namespace) => fs.rm(join(tmpdir(), namespace), { recursive: true, force: true })));
});

describe('createExpiringUploadCache', () => {
  it('reads back exactly what was stored, with a lease bounded by the absolute deadline', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'stored' } });

    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'stored' });
    expect(msUntil({ iso: lease.expiresAt })).toBeGreaterThan(0);
    expect(new Date(lease.expiresAt).getTime()).toBeLessThanOrEqual(new Date(lease.maxExpiresAt).getTime());
  });

  it('reports the remaining time as a duration as well as an instant', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { lease } = await cache.store({ userId: 1, payload: { label: 'stored' } });

    // Whole window minus the round trip, so a client can count down without
    // trusting its own clock to agree with the server's.
    expect(lease.expiresInMs).toBeGreaterThan(59_000);
    expect(lease.expiresInMs).toBeLessThanOrEqual(60_000);
    expect(lease.maxExpiresInMs).toBeGreaterThan(239_000);
    expect(lease.maxExpiresInMs).toBeLessThanOrEqual(240_000);
  });

  it('treats an entry past its expiry as missing', async () => {
    const { cache } = makeCache({ idleTtlMs: 30, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    advanceClock({ ms: 80 });

    await expect(cache.read({ userId: 1, id })).rejects.toThrow(NotFoundError);
    await expect(cache.read({ userId: 1, id })).rejects.toThrow(MISSING_MESSAGE);
  });

  it('keeps an entry alive past its original expiry once refreshed', async () => {
    const { cache } = makeCache({ idleTtlMs: 300, maxLifetimeMs: 240_000 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    advanceClock({ ms: 200 });

    const refreshed = await cache.refresh({ userId: 1, id });
    expect(new Date(refreshed.expiresAt).getTime()).toBeGreaterThan(new Date(lease.expiresAt).getTime());

    // Past the original expiry, so this read only succeeds because of the refresh.
    advanceClock({ ms: 200 });
    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'stored' });
  });

  it('never lets refreshing push the expiry past the absolute deadline', async () => {
    const { cache } = makeCache({ idleTtlMs: 400, maxLifetimeMs: 500 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    const deadline = new Date(lease.maxExpiresAt).getTime();

    for (let attempt = 0; attempt < 3; attempt++) {
      advanceClock({ ms: 60 });
      const refreshed = await cache.refresh({ userId: 1, id });

      expect(refreshed.maxExpiresAt).toBe(lease.maxExpiresAt);
      expect(new Date(refreshed.expiresAt).getTime()).toBeLessThanOrEqual(deadline);
    }

    // By now `now + idleTtlMs` is well past the deadline, so the lease must be
    // pinned to it rather than tracking the idle window.
    const final = await cache.refresh({ userId: 1, id });
    expect(final.expiresAt).toBe(final.maxExpiresAt);
  });

  it('refuses to refresh an id that never existed or has expired', async () => {
    const { cache } = makeCache({ idleTtlMs: 30, maxLifetimeMs: 240_000 });

    await expect(cache.refresh({ userId: 1, id: randomUUID() })).rejects.toThrow(MISSING_MESSAGE);

    const { id } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    advanceClock({ ms: 80 });

    await expect(cache.refresh({ userId: 1, id })).rejects.toThrow(NotFoundError);
  });

  it('pins a claimed entry to its absolute deadline', async () => {
    const { cache } = makeCache({ idleTtlMs: 300, maxLifetimeMs: 240_000 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'queued' } });
    const claimed = await cache.claim({ userId: 1, id, jobId: 'job-1' });

    expect(claimed.expiresAt).toBe(lease.maxExpiresAt);
    expect(claimed.maxExpiresAt).toBe(lease.maxExpiresAt);

    // Past the idle window, which nothing is refreshing once the work is queued.
    advanceClock({ ms: 400 });
    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'queued' });
  });

  it('never lets claiming push the entry past the absolute deadline', async () => {
    const { cache } = makeCache({ idleTtlMs: 1_000, maxLifetimeMs: 500 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'stored' } });

    const first = await cache.claim({ userId: 1, id, jobId: 'job-1' });
    advanceClock({ ms: 80 });
    const second = await cache.claim({ userId: 1, id, jobId: 'job-1' });

    expect(second.maxExpiresAt).toBe(lease.maxExpiresAt);
    expect(second.expiresAt).toBe(first.expiresAt);

    // Claiming buys the rest of the cap and nothing beyond it, however often it
    // is called, so the entry still dies on schedule.
    advanceClock({ ms: 600 });
    await expect(cache.read({ userId: 1, id })).rejects.toThrow(MISSING_MESSAGE);
  });

  it('refuses a second job while the job holding the entry is alive', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'queued' } });
    await cache.claim({ userId: 1, id, jobId: 'job-1' });

    const asked: string[] = [];
    const claimSecond = cache.claim({
      userId: 1,
      id,
      jobId: 'job-2',
      isClaimStale: async ({ jobId }) => {
        asked.push(jobId);
        return false;
      },
    });

    await expect(claimSecond).rejects.toThrow(ConflictError);
    // Staleness is asked about the job on the entry, not the one asking for it.
    expect(asked).toEqual(['job-1']);
    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'queued' });
  });

  it('lets a retry take the entry back from a job that died', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id, lease } = await cache.store({ userId: 1, payload: { label: 'queued' } });
    await cache.claim({ userId: 1, id, jobId: 'job-1' });

    const takenOver = await cache.claim({ userId: 1, id, jobId: 'job-2', isClaimStale: async () => true });
    expect(takenOver.expiresAt).toBe(lease.maxExpiresAt);

    // The takeover moved ownership, so the job that lost it is now the refused one.
    await expect(cache.claim({ userId: 1, id, jobId: 'job-1', isClaimStale: async () => false })).rejects.toThrow(
      ConflictError,
    );
  });

  it('lets the job already holding the entry claim it again', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'queued' } });
    const first = await cache.claim({ userId: 1, id, jobId: 'job-1' });

    let asked = false;
    const second = await cache.claim({
      userId: 1,
      id,
      jobId: 'job-1',
      isClaimStale: async () => {
        asked = true;
        return false;
      },
    });

    // Its own claim is never a conflict, so nothing has to be judged stale.
    expect(asked).toBe(false);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'queued' });
  });

  it('refuses to claim an id that never existed or has expired', async () => {
    const { cache } = makeCache({ idleTtlMs: 30, maxLifetimeMs: 240_000 });

    await expect(cache.claim({ userId: 1, id: randomUUID(), jobId: 'job-1' })).rejects.toThrow(MISSING_MESSAGE);

    const { id } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    advanceClock({ ms: 80 });

    await expect(cache.claim({ userId: 1, id, jobId: 'job-1' })).rejects.toThrow(NotFoundError);
  });

  it('leaves no half-written file behind when a lease is rewritten', async () => {
    const { cache, directory } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'stored' } });
    await cache.refresh({ userId: 1, id });
    await cache.claim({ userId: 1, id, jobId: 'job-1' });

    const remaining = await fs.readdir(directory);
    expect(remaining.filter((entry) => entry.includes(id))).toHaveLength(2);
  });

  it('scopes every entry to the user who stored it', async () => {
    const { cache } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'owner only' } });

    await expect(cache.read({ userId: 2, id })).rejects.toThrow(MISSING_MESSAGE);
    await expect(cache.refresh({ userId: 2, id })).rejects.toThrow(MISSING_MESSAGE);
    await expect(cache.claim({ userId: 2, id, jobId: 'job-1' })).rejects.toThrow(MISSING_MESSAGE);

    // The owner's entry is untouched by the failed lookups.
    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'owner only' });
  });

  it('rejects an id that is not a plain uuid, without touching the filesystem', async () => {
    // Nothing is stored first, so the cache directory does not exist yet. Any
    // path this cache built from a malformed id would have to create it.
    const { cache, directory } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    for (const id of ['../../etc/passwd', 'not-a-uuid', '', 'a/b', `${randomUUID()}.json`]) {
      await expect(cache.read({ userId: 1, id })).rejects.toThrow(MISSING_MESSAGE);
      await expect(cache.refresh({ userId: 1, id })).rejects.toThrow(MISSING_MESSAGE);
      await expect(cache.claim({ userId: 1, id, jobId: 'job-1' })).rejects.toThrow(MISSING_MESSAGE);
      await expect(cache.remove({ userId: 1, id })).rejects.toThrow(MISSING_MESSAGE);
    }

    await expect(fs.stat(directory)).rejects.toThrow();
  });

  it('will not let a malformed id reach an entry belonging to somebody else', async () => {
    const { cache, namespace } = makeCache({ idleTtlMs: 60_000, maxLifetimeMs: 240_000 });

    const { id } = await cache.store({ userId: 1, payload: { label: 'owner only' } });

    // Ids shaped to climb back out of the cache directory and land on the real
    // entry's file, which only the uuid guard stops.
    for (const crafted of [`../${namespace}/1-${id}`, `../${namespace}/1-${id}.json`, `..%2F${namespace}%2F1-${id}`]) {
      await expect(cache.read({ userId: 2, id: crafted })).rejects.toThrow(MISSING_MESSAGE);
    }

    expect(await cache.read({ userId: 1, id })).toEqual({ label: 'owner only' });
  });

  it('deletes expired entries from disk when it sweeps', async () => {
    const { cache, directory } = makeCache({ idleTtlMs: 1_000, maxLifetimeMs: 240_000 });

    const expired = await cache.store({ userId: 1, payload: { label: 'expired' } });

    // Under a minute, so `store` does not fire a second background sweep.
    advanceClock({ ms: 5_000 });
    const live = await cache.store({ userId: 1, payload: { label: 'live' } });
    // `store` fires the sweep in the background and at most once a minute, so
    // driving it here is what makes the assertions below deterministic.
    await cache.sweepExpired();

    const remaining = await fs.readdir(directory);
    expect(remaining.filter((entry) => entry.includes(expired.id))).toEqual([]);
    expect(remaining.filter((entry) => entry.includes(live.id))).toHaveLength(2);
  });
});
