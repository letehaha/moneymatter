import type { ChatRunEvent, ChatRunStatus } from '@bt/shared/types';
import ChatMessages from '@models/chat-messages.model';
import { redisClient } from '@root/redis-client';
import type { Response } from 'express';

import { encodeSseEvent, readRunEventsAfter, runStreamKey, type StreamEntry } from './event-log';
import { type RunSubscription, chatTailHub } from './tail-hub';

const HEARTBEAT_MS = 15_000;

/** The closing event of a run whose stream is gone, rebuilt from the stored message. */
const finishedEventOf = ({ message }: { message: Pick<ChatMessages, 'status' | 'error'> }): ChatRunEvent => ({
  type: 'run.finished',
  status: message.status as ChatRunStatus,
  ...(message.error ? { error: message.error } : {}),
});

const readMessage = ({ messageId }: { messageId: string }) =>
  ChatMessages.findByPk(messageId, { attributes: ['id', 'status', 'error'] });

/**
 * Writes a run's events to an open SSE response: the stream from the event after `afterId`, then live
 * events as they are appended, until `run.finished` or until the client goes away. Resolves when the
 * response is done.
 *
 * A run that ended long ago has no stream left (it expires an hour after the end), so its closing
 * event is rebuilt from the stored message. The heartbeat keeps proxies from closing an idle
 * connection, and also notices a run that ended without its closing event reaching the stream.
 */
export async function pipeRunEvents({
  res,
  runId,
  messageId,
  afterId,
}: {
  res: Response;
  runId: string;
  messageId: string;
  afterId: string;
}): Promise<void> {
  let subscription: RunSubscription | null = null;
  let lastDeliveredId = afterId;
  let done = false;
  const { promise: finished, resolve: resolveDone } = Promise.withResolvers<void>();

  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    subscription?.close();
    if (!res.writableEnded) res.end();
    resolveDone();
  };

  const write = ({ entry }: { entry: StreamEntry }) => {
    if (done) return;
    lastDeliveredId = entry.id;
    res.write(encodeSseEvent({ id: entry.id, event: entry.event }));
    if (entry.event.type === 'run.finished') finish();
  };

  const writeSynthetic = async () => {
    const message = await readMessage({ messageId });
    if (done || !message || message.status === 'streaming') return;

    res.write(encodeSseEvent({ event: finishedEventOf({ message }) }));
    finish();
  };

  const heartbeat = setInterval(() => {
    if (done) return;
    res.write(': heartbeat\n\n');

    // A run that is over with no closing event in the stream would otherwise hold the connection open.
    readMessage({ messageId })
      .then(async (message) => {
        if (done || !message || message.status === 'streaming') return;

        const rest = await readRunEventsAfter({ runId, afterId: lastDeliveredId });
        for (const entry of rest) write({ entry });
        if (!done) await writeSynthetic();
      })
      .catch(() => undefined);
  }, HEARTBEAT_MS);

  res.on('close', finish);

  try {
    subscription = await chatTailHub.subscribe({ runId, afterId, onEntry: (entry) => write({ entry }) });
    if (done) subscription.close();

    // Nothing in the stream and the run is over: the stream has expired, so tell the client how it ended.
    if (!done && (await redisClient.exists(runStreamKey({ runId }))) === 0) await writeSynthetic();
  } catch (error) {
    finish();
    throw error;
  }

  await finished;
}
