import type { ChatRunEvent } from '@bt/shared/types';
import { redisClient } from '@root/redis-client';

/**
 * The replayable log of one run: a Redis Stream the runner appends to and the SSE route reads from,
 * so a client that drops can resume after the last id it saw, and a reload replays a live run from
 * the start. The stream is capped and expires an hour after the run finishes.
 */

/** Approximate cap on entries per run (`MAXLEN ~`). */
const STREAM_MAX_ENTRIES = 5_000;
const STREAM_TTL_SECONDS = 60 * 60;
const DEFAULT_READ_COUNT = 500;
const STREAM_ID_PATTERN = /^\d+-\d+$/;
const FROM_THE_START = '0-0';

export interface StreamEntry {
  /** The Redis Stream id, `<ms>-<sequence>`. */
  id: string;
  event: ChatRunEvent;
}

export const runStreamKey = ({ runId }: { runId: string }): string => `chat:run:${runId}:events`;

/** Appends one event and returns its stream id. */
export const appendRunEvent = async ({ runId, event }: { runId: string; event: ChatRunEvent }): Promise<string> => {
  const id = await redisClient.xadd(
    runStreamKey({ runId }),
    'MAXLEN',
    '~',
    STREAM_MAX_ENTRIES,
    '*',
    'event',
    JSON.stringify(event),
  );
  if (id === null) throw new Error(`Redis did not accept an event for run ${runId}`);

  return id;
};

/** The event stored in one stream entry, or null for an entry that is not an event. */
export const parseStreamEntry = ({ id, fields }: { id: string; fields: string[] }): StreamEntry | null => {
  const index = fields.indexOf('event');
  const payload = index === -1 ? undefined : fields[index + 1];
  if (payload === undefined) return null;

  try {
    const event: unknown = JSON.parse(payload);
    if (typeof event !== 'object' || event === null || typeof (event as { type?: unknown }).type !== 'string') {
      return null;
    }
    return { id, event: event as ChatRunEvent };
  } catch {
    return null;
  }
};

export const parseStreamEntries = ({ raw }: { raw: Array<[string, string[]]> }): StreamEntry[] =>
  raw.flatMap(([id, fields]) => {
    const entry = parseStreamEntry({ id, fields });
    return entry ? [entry] : [];
  });

/** The events after `afterId`, oldest first, without blocking. */
export const readRunEventsAfter = async ({
  runId,
  afterId,
  count = DEFAULT_READ_COUNT,
}: {
  runId: string;
  afterId: string;
  count?: number;
}): Promise<StreamEntry[]> => {
  const result = await redisClient.xread('COUNT', count, 'STREAMS', runStreamKey({ runId }), afterId);
  const [stream] = result ?? [];

  return stream ? parseStreamEntries({ raw: stream[1] as Array<[string, string[]]> }) : [];
};

/** The id of the newest entry, or the start of the stream when there is none. */
export const lastRunEventId = async ({ runId }: { runId: string }): Promise<string> => {
  const [newest] = await redisClient.xrevrange(runStreamKey({ runId }), '+', '-', 'COUNT', 1);

  return newest ? newest[0] : FROM_THE_START;
};

export const expireRunStream = async ({ runId }: { runId: string }): Promise<void> => {
  await redisClient.expire(runStreamKey({ runId }), STREAM_TTL_SECONDS);
};

/**
 * One SSE frame. The `event:` name is the event type and `data:` its JSON without the type; JSON never
 * holds a raw newline, so a frame always ends at its blank line. A synthetic event has no `id`.
 */
export const encodeSseEvent = ({ id, event }: { id?: string; event: ChatRunEvent }): string => {
  const { type, ...data } = event;

  return `${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
};

/** The id to resume after: a header that is not a stream id (or is absent) starts from the beginning. */
export const normalizeLastEventId = ({ value }: { value: string | undefined }): string =>
  value && STREAM_ID_PATTERN.test(value) ? value : FROM_THE_START;

/** Orders two stream ids, comparing both parts as numbers (they can pass the safe integer range). */
export const compareStreamIds = ({ a, b }: { a: string; b: string }): number => {
  const [aMs = '0', aSeq = '0'] = a.split('-');
  const [bMs = '0', bSeq = '0'] = b.split('-');

  const ms = BigInt(aMs) - BigInt(bMs);
  if (ms !== 0n) return ms < 0n ? -1 : 1;

  const seq = BigInt(aSeq) - BigInt(bSeq);
  return seq === 0n ? 0 : seq < 0n ? -1 : 1;
};
