import { logger } from '@js/utils/logger';
import { REDIS_KEY_PREFIX, redisClient } from '@root/redis-client';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

import {
  type StreamEntry,
  compareStreamIds,
  lastRunEventId,
  parseStreamEntries,
  readRunEventsAfter,
  runStreamKey,
} from './event-log';

/**
 * Tails run streams for the SSE route. A blocking `XREAD` holds its connection for as long as it
 * waits, and the shared Redis client serves rate limits, the base-currency lock and caches, so the
 * hub reads on a connection of its own (a duplicate of the shared one). One loop per process reads
 * every open run's stream in a single `XREAD BLOCK … STREAMS k1 k2 …` and fans the entries out to
 * the subscribers of each run.
 *
 * The loop learns that the set of streams changed through a "wake" stream: adding a subscriber
 * appends an entry to it, which ends the blocking read at once so the next read includes the new
 * stream. (Waking through the stream, not through a client-side flag, cannot lose a wake-up that
 * lands between two reads.)
 */

const BLOCK_MS = 5_000;
const READ_COUNT = 200;
const CATCH_UP_COUNT = 500;
const WAKE_TTL_SECONDS = 600;
const ERROR_BACKOFF_MS = 1_000;
const RUN_KEY_PATTERN = /^chat:run:(.+):events$/;

export interface RunSubscription {
  /** Stops delivery. Safe to call more than once. */
  close: () => void;
}

interface Subscriber {
  runId: string;
  /** The id of the last entry delivered; nothing at or before it is delivered again. */
  lastId: string;
  /** False while the subscriber catches up on history; live entries wait in `queue` meanwhile. */
  ready: boolean;
  queue: StreamEntry[];
  closed: boolean;
  onEntry: (entry: StreamEntry) => void;
}

const withoutKeyPrefix = ({ key }: { key: string }): string =>
  REDIS_KEY_PREFIX && key.startsWith(REDIS_KEY_PREFIX) ? key.slice(REDIS_KEY_PREFIX.length) : key;

const sleep = ({ ms }: { ms: number }): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const deliver = ({ subscriber, entry }: { subscriber: Subscriber; entry: StreamEntry }) => {
  if (subscriber.closed || compareStreamIds({ a: entry.id, b: subscriber.lastId }) <= 0) return;

  subscriber.lastId = entry.id;
  try {
    subscriber.onEntry(entry);
  } catch (error) {
    logger.error({ message: 'A chat stream subscriber threw', error: error as Error });
  }
};

function createTailHub() {
  const subscribers = new Map<string, Set<Subscriber>>();
  /** Per run, the id the loop has read up to. */
  const cursors = new Map<string, string>();
  const wakeKey = `chat:hub:wake:${randomUUID()}`;
  let wakeCursor = '0-0';
  let connection: Redis | null = null;
  let loop: Promise<void> | null = null;
  let stopped = false;
  const isStopped = () => stopped;

  const route = ({ runId, entries }: { runId: string; entries: StreamEntry[] }) => {
    for (const subscriber of subscribers.get(runId) ?? []) {
      for (const entry of entries) {
        if (subscriber.ready) deliver({ subscriber, entry });
        else subscriber.queue.push(entry);
      }
    }
  };

  const wake = async () => {
    try {
      await redisClient.multi().xadd(wakeKey, 'MAXLEN', '1', '*', 'wake', '1').expire(wakeKey, WAKE_TTL_SECONDS).exec();
    } catch (error) {
      logger.warn('Could not wake the chat tail loop', { error: (error as Error).message });
    }
  };

  const readOnce = async (reader: Redis) => {
    const runIds = [...cursors.keys()];
    const result = await reader.xread(
      'COUNT',
      READ_COUNT,
      'BLOCK',
      BLOCK_MS,
      'STREAMS',
      wakeKey,
      ...runIds.map((runId) => runStreamKey({ runId })),
      wakeCursor,
      ...runIds.map((runId) => cursors.get(runId)!),
    );

    for (const [fullKey, raw] of result ?? []) {
      const key = withoutKeyPrefix({ key: fullKey });
      const entries = parseStreamEntries({ raw: raw as Array<[string, string[]]> });
      const lastRaw = (raw as Array<[string, string[]]>).at(-1);
      if (!lastRaw) continue;

      if (key === wakeKey) {
        wakeCursor = lastRaw[0];
        continue;
      }

      const runId = RUN_KEY_PATTERN.exec(key)?.[1];
      if (!runId || !cursors.has(runId)) continue;

      cursors.set(runId, lastRaw[0]);
      route({ runId, entries });
    }
  };

  const run = async (reader: Redis) => {
    while (!isStopped()) {
      try {
        await readOnce(reader);
      } catch (error) {
        if (isStopped()) return;
        logger.warn('Chat tail read failed, retrying', { error: (error as Error).message });
        await sleep({ ms: ERROR_BACKOFF_MS });
      }
    }
  };

  const ensureStarted = () => {
    if (connection) return;

    stopped = false;
    connection = redisClient.duplicate();
    connection.on('error', (error: Error) => {
      if (!error.message.includes('Connection is closed')) {
        logger.error({ message: 'Chat tail Redis error', error });
      }
    });
    loop = run(connection);
  };

  const unsubscribe = ({ subscriber }: { subscriber: Subscriber }) => {
    subscriber.closed = true;
    const group = subscribers.get(subscriber.runId);
    group?.delete(subscriber);

    if (group?.size === 0) {
      subscribers.delete(subscriber.runId);
      cursors.delete(subscriber.runId);
    }
  };

  const catchUp = async ({ subscriber }: { subscriber: Subscriber }) => {
    for (;;) {
      const batch = await readRunEventsAfter({
        runId: subscriber.runId,
        afterId: subscriber.lastId,
        count: CATCH_UP_COUNT,
      });
      for (const entry of batch) deliver({ subscriber, entry });
      if (batch.length < CATCH_UP_COUNT) break;
    }

    // Entries the loop read while the subscriber caught up; the ones already delivered are skipped.
    for (const entry of subscriber.queue.splice(0)) deliver({ subscriber, entry });
    subscriber.ready = true;
  };

  return {
    /**
     * Delivers every entry of the run after `afterId`, history first and then live, each once and in
     * order. The subscriber joins the live fan-out before it reads history, so no entry falls between.
     */
    subscribe: async ({
      runId,
      afterId,
      onEntry,
    }: {
      runId: string;
      afterId: string;
      onEntry: (entry: StreamEntry) => void;
    }): Promise<RunSubscription> => {
      ensureStarted();

      const subscriber: Subscriber = { runId, lastId: afterId, ready: false, queue: [], closed: false, onEntry };
      const group = subscribers.get(runId) ?? new Set<Subscriber>();
      group.add(subscriber);
      subscribers.set(runId, group);

      try {
        if (!cursors.has(runId)) {
          const newest = await lastRunEventId({ runId });
          if (!cursors.has(runId)) cursors.set(runId, newest);
        }
        await wake();
        await catchUp({ subscriber });
      } catch (error) {
        unsubscribe({ subscriber });
        throw error;
      }

      return { close: () => unsubscribe({ subscriber }) };
    },

    /** Ends the loop and closes the hub's connection; a later `subscribe` starts a fresh one. */
    close: async () => {
      if (!connection) return;

      stopped = true;
      await wake();
      const finished = loop;
      connection.disconnect();
      connection = null;
      loop = null;
      subscribers.clear();
      cursors.clear();
      wakeCursor = '0-0';
      await finished?.catch(() => undefined);
      await redisClient.del(wakeKey).catch(() => undefined);
    },
  };
}

export const chatTailHub = createTailHub();
