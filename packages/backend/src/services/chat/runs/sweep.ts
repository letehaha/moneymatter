import ChatMessages from '@models/chat-messages.model';
import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';

import { appendRunEvent, expireRunStream } from './event-log';
import { hasRunLease, releaseRunSlots } from './run-lease';

/**
 * Marks as interrupted every streaming message whose run no longer holds its lease: the process that
 * executed it died, so nothing will ever finish the message. The stream gets its closing event (a
 * client waiting on it sees the end), the run's counters are released and the stream is given its
 * expiry. A message with a live lease belongs to a running process and is left alone.
 */
export async function sweepInterruptedRuns(): Promise<{ interrupted: number }> {
  const streaming = await ChatMessages.findAll({
    where: { role: 'assistant', status: 'streaming', runId: { [Op.ne]: null } },
    attributes: ['id', 'threadId', 'userId', 'runId', 'parts'],
  });

  let interrupted = 0;
  for (const message of streaming) {
    const runId = message.runId!;
    if (await hasRunLease({ runId })) continue;

    const [updated] = await ChatMessages.update(
      {
        status: 'interrupted',
        parts: [...message.parts, { type: 'notice', id: randomUUID(), key: 'chat.notices.interrupted', params: {} }],
      },
      { where: { id: message.id, status: 'streaming' } },
    );
    // Another sweep (or the run itself) got there first.
    if (updated === 0) continue;

    await appendRunEvent({ runId, event: { type: 'run.finished', status: 'interrupted' } });
    await expireRunStream({ runId });
    await releaseRunSlots({ userId: message.userId, threadId: message.threadId, runId });
    interrupted++;
  }

  return { interrupted };
}
