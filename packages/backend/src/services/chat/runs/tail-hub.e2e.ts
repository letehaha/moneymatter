import type { ChatRunEvent } from '@bt/shared/types';
import { until } from '@common/helpers';
import { describe, expect, it } from '@jest/globals';
import { redisClient } from '@root/redis-client';
import { randomUUID } from 'node:crypto';

import { type StreamEntry, appendRunEvent } from './event-log';
import { type RunSubscription, chatTailHub } from './tail-hub';

/**
 * The hub needs a real Redis (the unit environment mocks the client without stream commands), and it
 * has no HTTP surface of its own beyond the SSE route, so this suite drives it directly.
 */

const delta = ({ text }: { text: string }): ChatRunEvent => ({ type: 'text.delta', partId: 'part', delta: text });
const finished: ChatRunEvent = { type: 'run.finished', status: 'complete' };

const collect = () => {
  const entries: StreamEntry[] = [];
  return { entries, onEntry: (entry: StreamEntry) => void entries.push(entry) };
};

const texts = ({ entries }: { entries: StreamEntry[] }) =>
  entries.flatMap(({ event }) => (event.type === 'text.delta' ? [event.delta] : []));

describe('Chat tail hub', () => {
  it('keeps the shared Redis client free while a tail is blocked', async () => {
    const run = randomUUID();
    const { onEntry } = collect();
    const subscription = await chatTailHub.subscribe({ runId: run, afterId: '0-0', onEntry });
    // Give the loop time to enter its blocking read.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const startedAt = Date.now();
    await redisClient.set('chat-tail-hub-probe', '1');
    expect(await redisClient.get('chat-tail-hub-probe')).toBe('1');
    expect(await redisClient.ping()).toBe('PONG');

    // A read on the client the tail blocks would wait out the 5 s block.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    subscription.close();
  });

  it('delivers the events of two runs to their own subscribers only', async () => {
    const [runA, runB] = [randomUUID(), randomUUID()];
    const [a, b] = [collect(), collect()];
    const subscriptionA = await chatTailHub.subscribe({ runId: runA, afterId: '0-0', onEntry: a.onEntry });
    const subscriptionB = await chatTailHub.subscribe({ runId: runB, afterId: '0-0', onEntry: b.onEntry });

    await appendRunEvent({ runId: runA, event: delta({ text: 'a1' }) });
    await appendRunEvent({ runId: runB, event: delta({ text: 'b1' }) });
    await appendRunEvent({ runId: runA, event: delta({ text: 'a2' }) });
    await appendRunEvent({ runId: runB, event: finished });

    await until(() => texts(a).length === 2 && b.entries.length === 2, { timeout: 5_000, interval: 25 });
    expect(texts(a)).toEqual(['a1', 'a2']);
    expect(texts(b)).toEqual(['b1']);
    expect(b.entries.at(-1)!.event).toEqual(finished);
    subscriptionA.close();
    subscriptionB.close();
  });

  it('hands a late subscriber the history first and then the live events, each once and in order', async () => {
    const run = randomUUID();
    const early = collect();
    const earlySubscription = await chatTailHub.subscribe({ runId: run, afterId: '0-0', onEntry: early.onEntry });
    await appendRunEvent({ runId: run, event: delta({ text: 'one' }) });
    await appendRunEvent({ runId: run, event: delta({ text: 'two' }) });
    await until(() => early.entries.length === 2, { timeout: 5_000, interval: 25 });

    const late = collect();
    const lateSubscription = await chatTailHub.subscribe({ runId: run, afterId: '0-0', onEntry: late.onEntry });
    await appendRunEvent({ runId: run, event: delta({ text: 'three' }) });
    await until(() => late.entries.length === 3 && early.entries.length === 3, { timeout: 5_000, interval: 25 });

    expect(texts(late)).toEqual(['one', 'two', 'three']);
    expect(texts(early)).toEqual(['one', 'two', 'three']);
    earlySubscription.close();
    lateSubscription.close();
  });

  it('resumes after a given id', async () => {
    const run = randomUUID();
    const firstId = await appendRunEvent({ runId: run, event: delta({ text: 'one' }) });
    await appendRunEvent({ runId: run, event: delta({ text: 'two' }) });
    const resumed = collect();

    const subscription = await chatTailHub.subscribe({ runId: run, afterId: firstId, onEntry: resumed.onEntry });
    await appendRunEvent({ runId: run, event: delta({ text: 'three' }) });
    await until(() => resumed.entries.length === 2, { timeout: 5_000, interval: 25 });

    expect(texts(resumed)).toEqual(['two', 'three']);
    subscription.close();
  });

  it('closes nothing shared when a subscriber leaves on run.finished, and serves the next one', async () => {
    const run = randomUUID();
    const first = collect();
    let subscription: RunSubscription | undefined;
    subscription = await chatTailHub.subscribe({
      runId: run,
      afterId: '0-0',
      onEntry: (entry) => {
        first.onEntry(entry);
        if (entry.event.type === 'run.finished') subscription?.close();
      },
    });
    await appendRunEvent({ runId: run, event: finished });
    await until(() => first.entries.length === 1, { timeout: 5_000, interval: 25 });

    expect(redisClient.status).toBe('ready');
    expect(await redisClient.ping()).toBe('PONG');

    const otherRun = randomUUID();
    const second = collect();
    const secondSubscription = await chatTailHub.subscribe({
      runId: otherRun,
      afterId: '0-0',
      onEntry: second.onEntry,
    });
    await appendRunEvent({ runId: otherRun, event: delta({ text: 'still works' }) });
    await until(() => second.entries.length === 1, { timeout: 5_000, interval: 25 });

    expect(texts(second)).toEqual(['still works']);
    secondSubscription.close();
  });
});
