import { describe, expect, it } from '@jest/globals';
import ChatMessages from '@models/chat-messages.model';
import ChatThreads from '@models/chat-threads.model';
import { chatRunSweepCron } from '@root/crons/chat-run-sweep';
import { redisClient } from '@root/redis-client';
import { appendRunEvent, runStreamKey } from '@services/chat/runs/event-log';
import { acquireRunSlots, runLeaseKey, threadRunsKey, userRunsKey } from '@services/chat/runs/run-lease';
import * as helpers from '@tests/helpers';
import { randomUUID } from 'node:crypto';

/** Arranges a run the way a crashed process leaves it: a streaming message, a stream and held slots. */
async function seedStreamingRun({ leaseAlive }: { leaseAlive: boolean }) {
  const thread = await helpers.createChatThread({ raw: true });
  const userId = await helpers.getTestUserId();
  const runId = randomUUID();
  const message = await ChatMessages.create({
    threadId: thread.id,
    userId,
    role: 'assistant',
    status: 'streaming',
    runId,
    parts: [{ type: 'text', id: randomUUID(), text: 'Half an ans' }],
    provider: 'custom',
    modelId: 'custom/llama3.2',
  });
  await appendRunEvent({
    runId,
    event: { type: 'run.started', runId, messageId: message.id, provider: 'custom', modelId: 'custom/llama3.2' },
  });
  expect(await acquireRunSlots({ userId, threadId: thread.id, runId })).toBe('ok');
  if (leaseAlive) await redisClient.set(runLeaseKey({ runId }), '1', 'EX', 60);

  return { threadId: thread.id, userId, runId, messageId: message.id };
}

describe('Chat run sweep cron', () => {
  it('marks a streaming message whose lease is gone as interrupted, however young it is, and ends its stream', async () => {
    const { threadId, runId, messageId } = await seedStreamingRun({ leaseAlive: false });

    const result = await chatRunSweepCron.triggerManualSync();

    expect(result).toEqual({ interrupted: 1 });
    const loaded = await helpers.getChatThread({ threadId, raw: true });
    const message = loaded.messages.find((item) => item.id === messageId)!;
    expect(message.status).toBe('interrupted');
    // What the run had written stays, followed by the notice.
    expect(message.parts[0]).toMatchObject({ type: 'text', text: 'Half an ans' });
    expect(message.parts).toContainEqual(expect.objectContaining({ type: 'notice', key: 'chat.notices.interrupted' }));

    const stream = await helpers.getChatRunEvents({ runId });
    expect(stream.statusCode).toBe(200);
    expect(stream.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'interrupted' });
    expect(await redisClient.ttl(runStreamKey({ runId }))).toBeGreaterThan(0);
  });

  it('releases the run counters of an interrupted run', async () => {
    const { threadId, userId } = await seedStreamingRun({ leaseAlive: false });
    expect(await redisClient.zcard(userRunsKey({ userId }))).toBe(1);
    expect(await redisClient.zcard(threadRunsKey({ threadId }))).toBe(1);

    await chatRunSweepCron.triggerManualSync();

    expect(await redisClient.zcard(userRunsKey({ userId }))).toBe(0);
    expect(await redisClient.zcard(threadRunsKey({ threadId }))).toBe(0);
    expect(await acquireRunSlots({ userId, threadId, runId: randomUUID() })).toBe('ok');
  });

  it('leaves a message with a live lease alone', async () => {
    const { threadId, userId, messageId } = await seedStreamingRun({ leaseAlive: true });

    const result = await chatRunSweepCron.triggerManualSync();

    expect(result).toEqual({ interrupted: 0 });
    const message = (await ChatMessages.findByPk(messageId))!;
    expect(message.status).toBe('streaming');
    expect(await redisClient.zcard(userRunsKey({ userId }))).toBe(1);
    expect(await ChatThreads.count({ where: { id: threadId } })).toBe(1);
  });

  it('ignores messages that are not streaming', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    await ChatMessages.create({
      threadId: thread.id,
      userId: await helpers.getTestUserId(),
      role: 'assistant',
      status: 'complete',
      runId: randomUUID(),
      parts: [],
    });

    expect(await chatRunSweepCron.triggerManualSync()).toEqual({ interrupted: 0 });
  });
});
