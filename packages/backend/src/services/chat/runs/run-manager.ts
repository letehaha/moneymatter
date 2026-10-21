import {
  CHAT_RUN_MAX_MS,
  type ChatMessageError,
  type ChatMessagePart,
  type ChatRunEvent,
  type ChatRunStatus,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import ChatMessages from '@models/chat-messages.model';
import { type AIClientResult } from '@services/ai/ai-client-factory';
import { randomUUID } from 'node:crypto';

import { createTextPolicy } from '../prompt/text-policy';
import type { ChatRunner } from '../runners/types';
import { notifyThreadUpdated } from '../threads/thread-events';
import { touchThread } from '../threads/touch-thread';
import { isRunCancelRequested } from './cancel';
import { appendRunEvent, expireRunStream } from './event-log';
import { describeRunFailure } from './run-failure';
import { type RunLease, releaseRunSlots } from './run-lease';
import { createRunRecorder } from './run-recorder';
import { type RunAbortReason, abortAllLocalRuns, registerLocalRun, unregisterLocalRun } from './run-registry';

/** How often the executor looks for a cancel flag set by another process. */
const CANCEL_POLL_MS = 1_000;
/** How long a shutdown waits for aborted runs to write their last state. */
const SHUTDOWN_GRACE_MS = 3_000;

interface ChatRunInput {
  runId: string;
  /** The assistant message the run fills. */
  messageId: string;
  /** The user message the run answers. */
  userMessageId: string;
  threadId: string;
  userId: number;
  aiClient: AIClientResult;
  /** The runner for the connection's provider, chosen by the caller before it took the run slots. */
  runner: ChatRunner;
  /** Held by the caller from before the message existed; the run releases it when it ends. */
  lease: RunLease;
}

const activeRuns = new Set<Promise<void>>();

const noticePart = ({ key }: { key: string }): ChatMessagePart => ({
  type: 'notice',
  id: randomUUID(),
  key,
  params: {},
});

const UNKNOWN_FAILURE = { code: 'unknown', messageKey: 'chat.errors.unknown' };

/** The line a stopped run ends with; a run that completes or fails on its own has none. */
const NOTICE_KEY_BY_STATUS: Partial<Record<ChatRunStatus, string>> = {
  cancelled: 'chat.notices.cancelled',
  interrupted: 'chat.notices.interrupted',
};

/** Aborts on a cancel flag from any process, on the wall-time ceiling and (through the registry) on shutdown or a local cancel. */
function createRunControl({ runId }: { runId: string }) {
  const controller = new AbortController();
  registerLocalRun({ runId, controller });

  const abort = ({ reason }: { reason: RunAbortReason }) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  const poll = setInterval(() => {
    isRunCancelRequested({ runId })
      .then((requested) => {
        if (requested) abort({ reason: 'cancelled' });
      })
      .catch((error: Error) => logger.warn('Chat cancel check failed', { runId, error: error.message }));
  }, CANCEL_POLL_MS);
  const ceiling = setTimeout(() => abort({ reason: 'timeout' }), CHAT_RUN_MAX_MS);

  return {
    signal: controller.signal,
    dispose: () => {
      clearInterval(poll);
      clearTimeout(ceiling);
      unregisterLocalRun({ runId });
    },
  };
}

interface RunEnd {
  status: ChatRunStatus;
  error?: ChatMessageError;
  stepCount: number;
}

async function executeRun(input: ChatRunInput): Promise<void> {
  const { runId, messageId, userMessageId, threadId, userId, aiClient, runner, lease } = input;
  const control = createRunControl({ runId });
  const recorder = createRunRecorder();

  const emit = async (event: ChatRunEvent) => {
    recorder.apply(event);
    await appendRunEvent({ runId, event });
  };
  const persist = async ({ stepCount }: { stepCount: number }) => {
    await ChatMessages.update(
      { parts: recorder.parts(), usage: recorder.usage(), stepCount },
      { where: { id: messageId, status: 'streaming' } },
    );
  };
  const textPolicy = createTextPolicy({ emit });

  let stepCount = 0;
  const persistStep = async (params: { stepCount: number }) => {
    stepCount = params.stepCount;
    await persist(params);
  };

  let end: RunEnd;
  try {
    await emit({ type: 'run.started', runId, messageId, provider: aiClient.provider, modelId: aiClient.modelId });

    const result = await runner({
      runId,
      threadId,
      messageId,
      userMessageId,
      userId,
      aiClient,
      signal: control.signal,
      emit,
      textPolicy,
      persist: persistStep,
    });
    end = { status: result.status === 'aborted' ? 'cancelled' : result.status, stepCount: result.stepCount };
  } catch (error) {
    // A stop that surfaces as a thrown abort error is a stop, not a failure.
    end = control.signal.aborted
      ? { status: 'cancelled', stepCount }
      : {
          status: 'failed',
          stepCount,
          error: await describeRunFailure({ error, userId, aiClient }).catch(() => UNKNOWN_FAILURE),
        };
  }

  // A stop is told apart by why the signal fired, not by how the runner noticed it.
  if (control.signal.aborted && end.status === 'cancelled') {
    const reason: unknown = control.signal.reason;
    if (reason === 'shutdown') end = { status: 'interrupted', stepCount: end.stepCount };
    if (reason === 'timeout') {
      end = {
        status: 'failed',
        stepCount: end.stepCount,
        error: { code: 'timeout', messageKey: 'chat.errors.timeout' },
      };
    }
  }

  try {
    await finishRun({ input, recorder, emit, end });
  } finally {
    control.dispose();
    await Promise.allSettled([lease.stop(), releaseRunSlots({ userId, threadId, runId })]);
  }
}

/** Runs one step of the end-of-run bookkeeping; a failure is logged and never stops the steps after it. */
async function attempt({ label, step }: { label: string; step: () => Promise<unknown> }): Promise<void> {
  try {
    await step();
  } catch (error) {
    logger.error({ message: `Chat run: ${label} failed`, error: error as Error });
  }
}

async function finishRun({
  input,
  recorder,
  emit,
  end,
}: {
  input: ChatRunInput;
  recorder: ReturnType<typeof createRunRecorder>;
  emit: (event: ChatRunEvent) => Promise<void>;
  end: RunEnd;
}) {
  const { runId, messageId, threadId, userId } = input;

  const notice = NOTICE_KEY_BY_STATUS[end.status];
  if (notice)
    await attempt({ label: 'notice', step: () => emit({ type: 'part.started', part: noticePart({ key: notice }) }) });

  const usage = recorder.usage();
  await attempt({
    label: 'storing the message',
    step: () =>
      ChatMessages.update(
        {
          status: end.status,
          parts: recorder.parts(),
          plainText: recorder.plainText(),
          usage,
          stepCount: end.stepCount,
          error: end.error ?? null,
        },
        { where: { id: messageId } },
      ),
  });
  await attempt({ label: 'updating the thread', step: () => touchThread({ userId, threadId, usage }) });

  // The stored message is final before the stream says so, so a client that reads the thread when
  // it sees the end gets the finished message.
  await attempt({
    label: 'closing the stream',
    step: async () => {
      await appendRunEvent({
        runId,
        event: { type: 'run.finished', status: end.status, ...(end.error ? { error: end.error } : {}) },
      });
      await expireRunStream({ runId });
    },
  });
  notifyThreadUpdated({ userId, threadId });
}

/** Starts the run detached from the request that created it. */
export function launchChatRun(input: ChatRunInput): void {
  const running = executeRun(input)
    .catch((error: Error) => logger.error({ message: 'A chat run crashed', error }))
    .finally(() => activeRuns.delete(running));
  activeRuns.add(running);
}

/** Interrupts every run of this process on shutdown and waits briefly for their last state to be written. */
export async function shutdownChatRuns(): Promise<void> {
  abortAllLocalRuns({ reason: 'shutdown' });

  await Promise.race([
    Promise.allSettled(activeRuns),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref()),
  ]);
}
