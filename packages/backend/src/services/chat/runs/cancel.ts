import type { ChatCancelRunResponse } from '@bt/shared/types';
import ChatMessages from '@models/chat-messages.model';
import { redisClient } from '@root/redis-client';

import { findRunMessage } from './find-run-message';
import { abortLocalRun } from './run-registry';

/** Longer than the run ceiling, so a flag set late in a run still outlives it. */
const CANCEL_FLAG_TTL_SECONDS = 15 * 60;

const runCancelKey = ({ runId }: { runId: string }): string => `chat:run:${runId}:cancel`;

/**
 * Asks a run to stop. The flag reaches a run on any replica (its executor polls for it) and the local
 * abort stops one in this process at once. Cancelling a run that has ended does nothing.
 */
const requestRunCancel = async ({ runId }: { runId: string }): Promise<void> => {
  await redisClient.set(runCancelKey({ runId }), '1', 'EX', CANCEL_FLAG_TTL_SECONDS);
  abortLocalRun({ runId, reason: 'cancelled' });
};

export const isRunCancelRequested = async ({ runId }: { runId: string }): Promise<boolean> =>
  (await redisClient.exists(runCancelKey({ runId }))) === 1;

/** `POST /chat/runs/:runId/cancel`. The run ends on its own; the answer says where it stands now. */
export const cancelRun = async ({
  userId,
  runId,
}: {
  userId: number;
  runId: string;
}): Promise<ChatCancelRunResponse> => {
  const message = await findRunMessage({ userId, runId });
  if (message.status === 'streaming') await requestRunCancel({ runId });

  return { runId, status: message.status };
};

/** Stops every run of a thread, for a thread that is being deleted. */
export const cancelRunsOfThread = async ({ runIds }: { runIds: string[] }): Promise<void> => {
  await Promise.all(runIds.map((runId) => requestRunCancel({ runId })));
};

export const findStreamingRunIds = async ({ threadId }: { threadId: string }): Promise<string[]> => {
  const rows = await ChatMessages.findAll({
    where: { threadId, role: 'assistant', status: 'streaming' },
    attributes: ['runId'],
  });

  return rows.flatMap((row) => (row.runId ? [row.runId] : []));
};
